import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { corsPreflight, withCors } from '../server/cors.ts';
import { pickFolder as defaultPickFolder } from './browse.ts';
import { pickerHtml } from './picker.ts';
import { addRecent, loadRecents, saveRecents } from './recents.ts';

/** A spawned (or fake) engine process. `ready` resolves with the engine base URL. */
export interface EngineHandle {
  pid: number | null
  ready: Promise<string>
  exit: Promise<{ exitCode: number | null }>
  errorText?: () => string | null
  proc?: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  isAlive?: () => boolean
}

export interface LauncherOptions {
  /** DI — tests inject fake handles (no real process). Receives the picked harness root. */
  spawnEngine: (root: string) => EngineHandle
  /** DI — tests assert kill calls; must reject on failure. */
  killEngine: (handle: EngineHandle) => Promise<void>
  /** Test seam — defaults to the repo's built `dist/index.html`. */
  distIndex?: string
  /** `--online` semantics: spawn the engine immediately (pairing URL prints without a UI click). Ignored while no root is picked — spawn defers past the pick. */
  autoStart?: boolean
  /** Recents persistence — defaults to the repo's `data/recents.json`. Tests point it at a temp file. */
  recentsFile?: string
  /** DI — native folder dialog; defaults to the real `pickFolder` (never invoked in tests). */
  pickFolder?: () => Promise<string | null>
}

export type EngineState = 'running' | 'starting' | 'stopped';

export interface LauncherStatus {
  ok: boolean
  engine: EngineState
  engineUrl: string | null
  /** Picked harness root; `''` while the picker is still showing. */
  root: string
  pid: number | null
  error?: string
  already?: boolean
}

const DEFAULT_DIST_INDEX = resolve(import.meta.dir, '..', '..', 'dist', 'index.html');
const DEFAULT_RECENTS_FILE = resolve(import.meta.dir, '..', '..', 'data', 'recents.json');
const READY_TIMEOUT_MS = 8000;
const STOP_TIMEOUT_MS = 5000;

async function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Reject after `ms`; always clears the timer so bun test sees no dangling handles. */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function json(status: number, body: unknown): Response {
  return withCors(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  }));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Inject launcher flags before `</head>` — the UI distinguishes modes by `__HM_LAUNCHER__`. */
export function injectLauncherFlags(html: string, rootAbs: string): string {
  const rootJson = JSON.stringify(rootAbs).replace(/</g, '\\u003c');
  const tag = `<script>window.__HM_LAUNCHER__=true;window.__HM_ROOT__=${rootJson};</script>`;
  if (html.includes('</head>')) { return html.replace('</head>', `${tag}</head>`); }
  return `${tag}${html}`;
}

/**
 * Buffered line filter over engine stdout: returns the complete `Online: …` lines found in the
 * chunk (partial lines carry over to the next one). The launcher drains the pipe silently, so
 * without this the pairing URL would never reach the user.
 */
export function createOnlineLineFilter(): (chunk: string) => string[] {
  let carry = '';
  return (chunk: string) => {
    carry += chunk;
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() ?? '';
    return lines.filter(line => line.startsWith('Online:'));
  };
}

async function readUrlFromStdout(stream: ReadableStream<Uint8Array>, timeoutMs: number, onChunk?: (text: string) => void): Promise<string | null> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) { return null; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), remaining); }),
      ]).finally(() => clearTimeout(timer));
      if (chunk === 'timeout' || chunk.done) { return null; }
      const text = decoder.decode(chunk.value, { stream: true });
      buffer += text;
      onChunk?.(text);
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(buffer);
      if (match) {
        // keep draining so the engine never blocks on a full stdout pipe
        void (async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) { return; }
              onChunk?.(decoder.decode(value, { stream: true }));
            }
          }
          catch { /* closed */ }
        })();
        return match[0];
      }
    }
  }
  catch { return null; }
}

async function waitForSnapshot(url: string, deadline: number, isDead: () => boolean): Promise<void> {
  while (Date.now() < deadline) {
    if (isDead()) { throw new Error('el proceso del motor murió al arrancar'); }
    try {
      const response = await fetch(`${url}/api/snapshot`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { return; }
    }
    catch { /* not listening yet */ }
    await delay(150);
  }
  throw new Error('el motor no respondió en 8s');
}

/**
 * Real engine spawn: `bun server.ts --root <root> --port 0` in the repo root,
 * ready = stdout URL parse (≤5s) + snapshot poll (≤8s overall from spawn).
 */
export function spawnEngineProcess(repoRoot: string, rootAbs: string, extraArgs: string[] = []): EngineHandle {
  const proc = Bun.spawn(['bun', 'server.ts', '--root', rootAbs, '--port', '0', ...extraArgs], {
    cwd: repoRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const spawnedAt = Date.now();
  let stderrTail = '';
  let childExited = false;
  void proc.exited.then(() => { childExited = true; });
  void (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { return; }
        stderrTail = `${stderrTail}${decoder.decode(value, { stream: true })}`.slice(-4000);
      }
    }
    catch { /* closed */ }
  })();
  const ready = (async () => {
    // The ready-drain swallows engine stdout — echo `Online:` lines so the pairing URL is visible.
    const echoOnline = createOnlineLineFilter();
    const url = await readUrlFromStdout(proc.stdout, 5000, (text) => {
      for (const line of echoOnline(text)) { console.log(line); }
    });
    if (!url) { throw new Error('el motor no publicó su URL en 5s'); }
    await waitForSnapshot(url, spawnedAt + READY_TIMEOUT_MS, () => childExited);
    return url;
  })();
  ready.catch(() => {}); // handle early rejection; callers still await `ready`
  return {
    pid: proc.pid,
    ready,
    exit: proc.exited.then(exitCode => ({ exitCode })),
    errorText: () => stderrTail.trim() || null,
    proc,
    isAlive: () => proc.exitCode === null,
  };
}

/** Graceful kill: win32 `taskkill /T /F`; posix SIGTERM → SIGKILL after 5s. */
export async function killEngineProcess(handle: EngineHandle): Promise<void> {
  if (handle.pid == null) { return; }
  if (handle.isAlive && !handle.isAlive()) { return; }
  if (process.platform === 'win32') {
    const result = Bun.spawnSync(['taskkill', '/pid', String(handle.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'pipe' });
    if (result.exitCode !== 0 && (handle.isAlive?.() ?? false)) {
      throw new Error(`taskkill falló (exit ${result.exitCode})`);
    }
    return;
  }
  handle.proc?.kill('SIGTERM');
  const died = await withTimeout(handle.exit, STOP_TIMEOUT_MS, 'SIGTERM sin respuesta').then(() => true, () => false);
  if (!died) { handle.proc?.kill('SIGKILL'); }
}

/**
 * Launcher request handler (no sockets) — the entry `launcher.ts` binds it to 127.0.0.1:7397.
 * Routes: GET / (picker page while no root is picked, built UI after) · GET /api/status ·
 * GET /api/recents · POST /api/browse · POST /api/root · POST /api/start · POST /api/stop.
 */
export function createLauncher(rootInput: string | null, options: LauncherOptions): (req: Request) => Promise<Response> {
  const distIndex = options.distIndex ?? DEFAULT_DIST_INDEX;
  const recentsFile = options.recentsFile ?? DEFAULT_RECENTS_FILE;
  const pickFolderImpl = options.pickFolder ?? defaultPickFolder;
  const state = {
    pickedRoot: rootInput === null ? null : resolve(rootInput),
    engine: 'stopped' as EngineState,
    engineUrl: null as string | null,
    pid: null as number | null,
    error: undefined as string | undefined,
    handle: null as EngineHandle | null,
    stopping: null as EngineHandle | null,
    watched: null as EngineHandle | null,
  };

  function statusBody(extra?: { already?: boolean }): LauncherStatus {
    return {
      ok: true,
      engine: state.engine,
      engineUrl: state.engineUrl,
      root: state.pickedRoot ?? '',
      pid: state.pid,
      ...(state.error ? { error: state.error } : {}),
      ...(extra?.already ? { already: true } : {}),
    };
  }

  function watchExit(handle: EngineHandle): void {
    if (state.watched === handle) { return; }
    state.watched = handle;
    void handle.exit.then(({ exitCode }) => {
      const intentional = state.stopping === handle;
      if (state.stopping === handle) { state.stopping = null; }
      if (state.handle !== handle) { return; } // stale handle (spawn failure already cleaned)
      state.handle = null;
      state.pid = null;
      state.engineUrl = null;
      state.engine = 'stopped';
      if (!intentional && exitCode !== 0) {
        state.error = handle.errorText?.() || `el motor terminó con código ${exitCode}`;
      }
    });
  }

  async function start(): Promise<Response> {
    const pickedRoot = state.pickedRoot;
    if (pickedRoot === null) { return json(400, { ok: false, error: 'no_root', detail: 'Elegí un harness antes de iniciar el motor.' }); }
    if (state.handle) { return json(200, statusBody({ already: true })); }
    state.engine = 'starting';
    state.error = undefined;
    let handle: EngineHandle | null = null;
    try {
      handle = options.spawnEngine(pickedRoot);
      state.handle = handle;
      state.pid = handle.pid;
      watchExit(handle);
      const url = await withTimeout(handle.ready, READY_TIMEOUT_MS, 'el motor no publicó su URL en 8s');
      state.engineUrl = url;
      state.engine = 'running';
      state.error = undefined;
      return json(200, statusBody());
    }
    catch (error) {
      const detail = messageOf(error);
      if (handle) {
        state.stopping = handle; // suppress crash-error reporting for the cleanup kill
        state.handle = null;
        state.pid = null;
        state.engineUrl = null;
        await options.killEngine(handle).catch(() => {});
        if (state.stopping === handle) { state.stopping = null; }
      }
      state.engine = 'stopped';
      state.error = detail;
      return json(500, { ...statusBody(), ok: false, error: 'spawn_failed', detail });
    }
  }

  async function stop(): Promise<Response> {
    const handle = state.handle;
    if (!handle) { return json(200, statusBody({ already: true })); }
    state.stopping = handle;
    try {
      await options.killEngine(handle);
      await withTimeout(handle.exit, STOP_TIMEOUT_MS, 'el motor no terminó en 5s');
      if (state.handle === handle) { // watcher fallback (exit listener order not guaranteed)
        state.handle = null;
        state.pid = null;
        state.engineUrl = null;
        state.engine = 'stopped';
      }
      if (state.stopping === handle) { state.stopping = null; }
      return json(200, statusBody());
    }
    catch (error) {
      if (state.stopping === handle) { state.stopping = null; }
      const detail = messageOf(error);
      return json(500, { ...statusBody(), ok: false, error: 'kill_failed', detail });
    }
  }

  /** POST /api/root — validate the picked path, spawn, then record it in recents (spec §3.5/§3.6). */
  async function setRoot(req: Request): Promise<Response> {
    let payload: unknown = null;
    try { payload = await req.json(); }
    catch { return json(400, { ok: false, error: 'invalid_root', detail: 'El cuerpo debe ser JSON con la propiedad path.' }); }
    const path = (payload as { path?: unknown } | null)?.path;
    if (typeof path !== 'string' || path.trim() === '') {
      return json(400, { ok: false, error: 'invalid_root', detail: 'Falta la ruta del harness (path).' });
    }
    if (!isAbsolute(path)) {
      return json(400, { ok: false, error: 'invalid_root', detail: `La ruta debe ser absoluta: ${path}` });
    }
    if (!existsSync(path)) {
      return json(400, { ok: false, error: 'invalid_root', detail: `La ruta no existe: ${path}` });
    }
    let directory = false;
    try { directory = statSync(path).isDirectory(); }
    catch { directory = false; } // deleted between checks — spec §5: same 400 as invalid
    if (!directory) {
      return json(400, { ok: false, error: 'invalid_root', detail: `La ruta no es un directorio: ${path}` });
    }
    state.pickedRoot = path;
    const started = await start();
    if (started.status !== 200) { return started; } // spawn failed — pickedRoot stays so Iniciar can retry
    try {
      saveRecents(recentsFile, addRecent(loadRecents(recentsFile), path));
    }
    catch { /* recents persistence must not fail a successful pick */ }
    return json(200, statusBody());
  }

  /** POST /api/browse — native folder dialog (injectable); cancel stays a 200 no-op (spec §5). */
  async function browse(): Promise<Response> {
    try {
      const path = await pickFolderImpl();
      if (path === null) { return json(200, { ok: true, cancelled: true }); }
      return json(200, { ok: true, path });
    }
    catch (error) {
      const code = (error as { code?: unknown }).code;
      const stable = code === 'browse_unsupported' || code === 'browse_failed' ? code : 'browse_failed';
      return json(500, { ok: false, error: stable, detail: messageOf(error) });
    }
  }

  if (options.autoStart && state.pickedRoot !== null) { void start(); }

  return async function handleRequest(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') { return corsPreflight(); }
    const { pathname } = new URL(req.url);

    if (pathname === '/api/status' && req.method === 'GET') { return json(200, statusBody()); }
    if (pathname === '/api/recents' && req.method === 'GET') { return json(200, { ok: true, recents: loadRecents(recentsFile) }); }
    if (pathname === '/api/browse' && req.method === 'POST') { return browse(); }
    if (pathname === '/api/root' && req.method === 'POST') { return setRoot(req); }
    if (pathname === '/api/start' && req.method === 'POST') { return start(); }
    if (pathname === '/api/stop' && req.method === 'POST') { return stop(); }
    if (pathname.startsWith('/api/')) {
      return json(404, { ok: false, error: 'not_found', detail: `${req.method} ${pathname}` });
    }

    if (pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (state.pickedRoot === null) {
        const html = pickerHtml(loadRecents(recentsFile));
        return withCors(new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
      }
      if (!existsSync(distIndex)) {
        return json(503, { ok: false, error: 'build_missing', detail: 'Ejecutá `bun run build` antes de usar el launcher (falta dist/index.html)' });
      }
      const html = injectLauncherFlags(readFileSync(distIndex, 'utf8'), state.pickedRoot);
      return withCors(new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    }
    return json(404, { ok: false, error: 'not_found', detail: `${req.method} ${pathname}` });
  };
}
