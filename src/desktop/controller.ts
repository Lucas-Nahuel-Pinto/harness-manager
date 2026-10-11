/**
 * DESKTOP CONTROLLER — pure lifecycle for the Electrobun main process (spec §4).
 *
 * Every external seam is injectable (`spawnEngine`, `openUrl`, `recentsFile`),
 * so unit tests run with zero real processes, dialogs, or network. The view
 * (Phase 2) subscribes to the state machine and renders; this module holds no
 * UI code. Validation uses only `node:fs`/`node:path` — safe in the Bun main
 * process and under `bun test`.
 */

import type { RecentEntry } from '../agent/recents.ts';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { addRecent, loadRecents, saveRecents } from '../agent/recents.ts';
import { onlineUrlFromLine } from './online-lines.ts';

/** A spawned (or fake) engine, as the controller needs it: lines, exit, kill. */
export interface EngineHandle {
  /** Stream of complete stdout lines (wiring feeds `createOnlineLineFilter` output). */
  onLine: (cb: (line: string) => void) => void
  exit: Promise<{ exitCode: number | null }>
  /** Graceful kill with 5s escalation — see `createKillEngine`. */
  kill: () => Promise<KillOutcome>
}

export type KillOutcome = 'graceful' | 'escalated' | 'already-dead';

export type ControllerState = 'picker' | 'starting' | 'running' | 'crashed' | 'error';

export type PickResult
  = | { ok: true, pairingUrl: string }
    | { ok: false, detail: string };

export interface ControllerOptions {
  /** DI — tests inject a fake handle (no real process). Receives the picked harness root. */
  spawnEngine: (root: string) => EngineHandle
  /** DI — opens the pairing URL in the default browser; tests assert calls. */
  openUrl: (url: string) => void
  /** Recents persistence — tests point it at a temp file. */
  recentsFile: string
  /** `HM_NO_OPEN`: suppress the automatic browser open; the URL is still returned/displayed. */
  hmNoOpen?: boolean
}

export interface DesktopController {
  getState: () => ControllerState
  /** Notified on every state change; returns an unsubscribe function. */
  subscribe: (cb: (state: ControllerState) => void) => () => void
  recents: () => RecentEntry[]
  pickRoot: (path: string) => Promise<PickResult>
  openPairing: (pairingUrl: string) => void
  detener: () => Promise<void>
}

const DEFAULT_STOP_TIMEOUT_MS = 5000;

/** Engine spawn argv: today's launcher args PLUS always-online (spec §3.3). */
export function engineArgs(root: string): string[] {
  return ['bun', 'server.ts', '--root', root, '--port', '0', '--online'];
}

/** Low-level kill seams the desktop main process injects (taskkill vs SIGTERM/SIGKILL). */
export interface KillSeams {
  /** Termination request: `graceful` first (SIGTERM / taskkill /T /F); `force` only after the timeout (SIGKILL). */
  kill: (mode: 'graceful' | 'force') => Promise<void>
  /** Resolves once the process is gone. */
  exit: Promise<{ exitCode: number | null }>
  /** Cheap liveness probe; absent → treated as alive until `exit` settles. */
  isAlive?: () => boolean
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

/**
 * Graceful kill with 5s escalation — ported from the launcher's `killEngineProcess`
 * (posix path: SIGTERM → wait → SIGKILL). On win32 the injected `kill('graceful')`
 * is already `taskkill /T /F`, so the wait resolves and no escalation fires.
 */
export function createKillEngine(seams: KillSeams, stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS): () => Promise<KillOutcome> {
  return async () => {
    if (seams.isAlive && !seams.isAlive()) { return 'already-dead'; }
    await seams.kill('graceful');
    const died = await withTimeout(seams.exit, stopTimeoutMs, 'SIGTERM sin respuesta').then(() => true, () => false);
    if (died) { return 'graceful'; }
    await seams.kill('force');
    return 'escalated';
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Spanish validation messages (same copy style as the launcher's 400s). */
function validateRoot(path: string): string | null {
  if (path.trim() === '') { return 'Falta la ruta del harness (path).'; }
  if (!isAbsolute(path)) { return `La ruta debe ser absoluta: ${path}`; }
  if (!existsSync(path)) { return `La ruta no existe: ${path}`; }
  try {
    if (!statSync(path).isDirectory()) { return `La ruta no es un directorio: ${path}`; }
  }
  catch { return `La ruta no es un directorio: ${path}`; } // deleted between checks — same failure as invalid
  return null;
}

export function createController(opts: ControllerOptions): DesktopController {
  let state: ControllerState = 'picker';
  let handle: EngineHandle | null = null;
  let stopping: EngineHandle | null = null;
  const listeners = new Set<(state: ControllerState) => void>();

  function setState(next: ControllerState): void {
    if (state === next) { return; }
    state = next;
    for (const cb of listeners) { cb(next); }
  }

  /** Crash watcher: an exit that was not `detener()` while running → `crashed` (spec §3.4). */
  function watchExit(h: EngineHandle): void {
    void h.exit.then(() => {
      if (handle !== h) { return; } // stale handle (intentional stop already cleaned up)
      handle = null;
      if (stopping === h) { stopping = null; setState('picker'); return; }
      if (state === 'running') { setState('crashed'); }
    });
  }

  function openPairing(pairingUrl: string): void {
    if (opts.hmNoOpen) { return; }
    opts.openUrl(pairingUrl);
  }

  async function pickRoot(path: string): Promise<PickResult> {
    if (state === 'starting' || state === 'running') {
      return { ok: false, detail: 'El motor ya está en ejecución.' };
    }
    const invalid = validateRoot(path);
    if (invalid !== null) { return { ok: false, detail: invalid }; }

    setState('starting');
    let h: EngineHandle;
    try {
      h = opts.spawnEngine(path);
    }
    catch (error) {
      setState('error');
      return { ok: false, detail: messageOf(error) };
    }
    handle = h;

    // First `Online: <url>` line wins; an exit before any line is a start failure.
    const outcome = await new Promise<PickResult>((resolve) => {
      let settled = false;
      const finish = (result: PickResult): void => {
        if (settled) { return; }
        settled = true;
        resolve(result);
      };
      h.onLine((line) => {
        const url = onlineUrlFromLine(line);
        if (url !== null) { finish({ ok: true, pairingUrl: url }); }
      });
      void h.exit.then(({ exitCode }) => {
        finish({ ok: false, detail: `el motor terminó antes de publicar la URL de emparejamiento (código ${exitCode ?? 'n/a'})` });
      });
    });

    if (!outcome.ok) {
      handle = null;
      setState('error');
      return outcome; // recents NOT written (spec §5)
    }

    setState('running');
    watchExit(h);
    try {
      saveRecents(opts.recentsFile, addRecent(loadRecents(opts.recentsFile), path));
    }
    catch { /* recents persistence must not fail a successful pick */ }
    // Auto-open the hosted app already paired; HM_NO_OPEN keeps the URL display-only (spec §3.8).
    openPairing(outcome.pairingUrl);
    return outcome;
  }

  return {
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    recents: () => loadRecents(opts.recentsFile),
    pickRoot,
    openPairing,
    async detener() {
      const h = handle;
      if (!h) { setState('picker'); return; }
      stopping = h;
      try {
        await h.kill();
      }
      finally {
        if (handle === h) { handle = null; }
        if (stopping === h) { stopping = null; }
        setState('picker');
      }
    },
  };
}
