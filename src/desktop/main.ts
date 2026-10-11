/**
 * DESKTOP MAIN — Electrobun window + RPC glue for the desktop controller (spec §3.4/§3.8).
 *
 * Thin layer only: spawns/kills the engine through the Phase 1 controller, owns the
 * BrowserWindow, and shuttles state between controller and view over RPC. Kill-on-close
 * is belt-and-braces: the window `close` handler, the vetoable `before-quit` event, and
 * `process.on('exit')` all try to take the engine down with the app (spec §8).
 */

import type { EngineHandle } from './controller.ts';
import type { ElectrobunBunSurface } from './electrobun-surface.ts';
import type { BrowseResult, DesktopRPCSchema, DesktopSnapshot } from './rpc-schema.ts';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openInOs } from '../actions/open.ts';
import { pickFolder } from './browse.ts';
import {
  createController,
  createKillEngine,
  engineArgs,
} from './controller.ts';
import { createOnlineLineFilter } from './online-lines.ts';

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 560;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Walk up from `start` until the repo markers (server.ts + electrobun.config.ts) are found. */
function walkToRepoRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'server.ts')) && existsSync(join(dir, 'electrobun.config.ts'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) { return null; }
    dir = parent;
  }
}

/**
 * Repo root discovery: a built bundle runs from `<repo>/build/…/bin`, dev runs from
 * `<repo>/src/desktop` — walk up from both, with `HM_REPO_ROOT` as the escape hatch
 * for exotic launchers (double-click from an unrelated cwd).
 */
function findRepoRoot(): string {
  const override = process.env.HM_REPO_ROOT;
  if (override) { return resolve(override); }
  const found = walkToRepoRoot(process.cwd()) ?? walkToRepoRoot(import.meta.dir);
  if (found === null) {
    throw new Error(
      'No se encontró la raíz del repo harness-manager (server.ts + electrobun.config.ts). Definí HM_REPO_ROOT.',
    );
  }
  return found;
}

/** Best-effort synchronous kill for the `process.on('exit')` belt — no awaits possible there. */
function killSync(proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>): void {
  if (proc.exitCode !== null) { return; }
  try {
    if (process.platform === 'win32') {
      Bun.spawnSync(['taskkill', '/pid', String(proc.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' });
    }
    else {
      proc.kill('SIGKILL');
    }
  }
  catch { /* process already gone */ }
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  const recentsFile = join(repoRoot, 'data', 'recents.json');
  let activeProc: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | null = null;

  // electrobun@1.18.1's raw .ts sources fail this repo's strict tsc gate, and a tsconfig
  // `paths` shim would hijack Bun's runtime resolution too — so the module is loaded via a
  // non-literal specifier (tsc cannot resolve it → stays out of the type graph) and narrowed
  // to the hand-written surface in ./electrobun-surface.ts.
  const electrobunSpecifier: string = 'electrobun/bun';
  const electrobun = await import(electrobunSpecifier) as unknown as ElectrobunBunSurface;
  const { BrowserView, BrowserWindow, Screen } = electrobun;
  const Electrobun = electrobun.default;

  /** Real engine spawn: same argv as the launcher, run from the repo root (spec §3.3). */
  function spawnEngine(root: string): EngineHandle {
    const proc = Bun.spawn(engineArgs(root), {
      cwd: repoRoot,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    activeProc = proc;
    // Holder object: a plain `let` would be narrowed to `null` inside the pump closure.
    const lineSink: { cb: ((line: string) => void) | null } = { cb: null };

    void (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      const online = createOnlineLineFilter();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) { return; }
          for (const line of online(decoder.decode(value, { stream: true }))) {
            lineSink.cb?.(line);
          }
        }
      }
      catch { /* pipe closed */ }
    })();

    void (async () => { // drain stderr so the engine never blocks on a full pipe
      const reader = proc.stderr.getReader();
      try {
        for (;;) {
          const { done } = await reader.read();
          if (done) { return; }
        }
      }
      catch { /* pipe closed */ }
    })();

    return {
      onLine(cb) { lineSink.cb = cb; },
      exit: proc.exited.then(exitCode => ({ exitCode })),
      kill: createKillEngine({
        async kill(mode) {
          if (proc.exitCode !== null) { return; }
          if (process.platform === 'win32') {
            Bun.spawnSync(['taskkill', '/pid', String(proc.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' });
            return;
          }
          try { proc.kill(mode === 'graceful' ? 'SIGTERM' : 'SIGKILL'); }
          catch { /* already gone */ }
        },
        exit: proc.exited.then(exitCode => ({ exitCode })),
        isAlive: () => proc.exitCode === null,
      }),
    };
  }

  const controller = createController({
    spawnEngine,
    // Explicit pairing (auto on pick, or the view's "Abrir app") uses the default browser.
    openUrl: (url) => { openInOs(url); },
    recentsFile,
    hmNoOpen: process.env.HM_NO_OPEN === '1',
  });

  // Tracked outside the controller — it exposes no root/url/detail (Phase 1 contract).
  let currentRoot: string | null = null;
  let currentUrl: string | null = null;
  let lastDetail: string | null = null;

  function snapshot(): DesktopSnapshot {
    return {
      state: controller.getState(),
      root: currentRoot,
      recents: controller.recents(),
      pairingUrl: currentUrl,
      detail: lastDetail,
    };
  }

  async function browse(): Promise<BrowseResult> {
    try {
      const path = await pickFolder();
      if (path === null) { return { ok: true, cancelled: true }; }
      return { ok: true, path };
    }
    catch (error) {
      const code = (error as { code?: unknown }).code;
      const stable = code === 'browse_unsupported' ? 'browse_unsupported' : 'browse_failed';
      return { ok: false, error: stable, detail: messageOf(error) };
    }
  }

  let allowQuit = false;
  let shuttingDown = false;

  /** Kill the engine, then force the quit sequence electrobun vetoed while we worked. */
  async function shutdown(): Promise<void> {
    if (shuttingDown) { return; }
    shuttingDown = true;
    try {
      await controller.detener();
    }
    finally {
      allowQuit = true;
      process.exit(0);
    }
  }

  // Veto every quit path (window close, SIGINT/SIGTERM via electrobun, Cmd+Q) until the
  // engine is down; then re-issue the quit with the veto lifted (spec §8 / §3.4).
  Electrobun.events.on('before-quit', (event) => {
    if (allowQuit) { return; }
    event.response = { allow: false };
    void shutdown();
  });
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('exit', () => { // last-resort sync kill if forceExit never ran
    if (activeProc) { killSync(activeProc); }
  });

  const rpc = BrowserView.defineRPC<DesktopRPCSchema>({
    handlers: {
      requests: {
        getInitial: () => snapshot(),
        async pickRoot(params) {
          const result = await controller.pickRoot(params.path);
          if (result.ok) {
            currentRoot = params.path;
            currentUrl = result.pairingUrl;
          }
          else {
            lastDetail = result.detail;
          }
          rpc.send('state', snapshot());
          return result;
        },
        browse,
        openApp() {
          // Explicit user click — opens even with HM_NO_OPEN set (console fallback stays display-only).
          if (currentUrl === null) { return { ok: false }; }
          openInOs(currentUrl);
          return { ok: true };
        },
        async reset() {
          await controller.detener();
          rpc.send('state', snapshot());
          return { ok: true };
        },
        quit() {
          void shutdown();
          return { ok: true };
        },
      },
      messages: {},
    },
  });

  controller.subscribe((state) => {
    if (state === 'picker') {
      currentRoot = null;
      currentUrl = null;
      lastDetail = null;
    }
    if (state === 'crashed') {
      currentUrl = null; // dead engine → dead pairing URL; root stays for re-pick
      lastDetail = null;
    }
    rpc.send('state', snapshot());
  });

  const workArea = Screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    title: 'harness-manager',
    url: 'views://mainview/index.html',
    frame: {
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      x: Math.max(0, workArea.x + Math.round((workArea.width - WINDOW_WIDTH) / 2)),
      y: Math.max(0, workArea.y + Math.round((workArea.height - WINDOW_HEIGHT) / 2)),
    },
    rpc,
  });
  win.on('close', () => { void shutdown(); });

  rpc.send('state', snapshot());
}

void main();
