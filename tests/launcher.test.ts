import type { EngineHandle, LauncherOptions } from '../src/launcher/app.ts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createLauncher, createOnlineLineFilter, injectLauncherFlags } from '../src/launcher/app.ts';
import { createApp } from '../src/server/app.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mini-harness');
const ROOT = join(tmpdir(), 'hm-launcher-root');

type Json = Record<string, unknown>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface FakeEngine {
  handle: EngineHandle
  ready: ReturnType<typeof deferred<string>>
  exit: ReturnType<typeof deferred<{ exitCode: number | null }>>
}

function fakeEngine(pid = 4242, errorText: string | null = null): FakeEngine {
  const ready = deferred<string>();
  const exit = deferred<{ exitCode: number | null }>();
  const handle: EngineHandle = {
    pid,
    ready: ready.promise,
    exit: exit.promise,
    errorText: () => errorText,
    isAlive: () => true,
  };
  return { handle, ready, exit };
}

function build(engine: FakeEngine, overrides: Partial<LauncherOptions> = {}) {
  const state = { spawns: 0, kills: 0, killedWith: null as EngineHandle | null, killError: null as Error | null };
  const app = createLauncher(ROOT, {
    spawnEngine: () => {
      state.spawns += 1;
      return engine.handle;
    },
    killEngine: async (handle) => {
      state.kills += 1;
      state.killedWith = handle;
      if (state.killError) { throw state.killError; }
      engine.exit.resolve({ exitCode: 0 });
    },
    ...overrides,
  });
  return { app, state };
}

function request(pathname: string, method = 'GET'): Request {
  return new Request(`http://127.0.0.1:7397${pathname}`, { method });
}

async function body(response: Response): Promise<Json> {
  return await response.json() as Json;
}

async function start(app: ReturnType<typeof createLauncher>, engine: FakeEngine, url = 'http://127.0.0.1:41000'): Promise<Response> {
  const pending = app(request('/api/start', 'POST'));
  engine.ready.resolve(url);
  return pending;
}

describe('POST /api/start', () => {
  test('spawn → ready → running with engineUrl + pid; second call is already:true', async () => {
    const engine = fakeEngine();
    const { app, state } = build(engine);
    const response = await start(app, engine);
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({
      ok: true,
      engine: 'running',
      engineUrl: 'http://127.0.0.1:41000',
      pid: 4242,
    });
    expect(state.spawns).toBe(1);

    const again = await body(await app(request('/api/start', 'POST')));
    expect(again.ok).toBe(true);
    expect(again.already).toBe(true);
    expect(state.spawns).toBe(1);
  });

  test('ready rejection → 500 spawn_failed, child killed, status stopped', async () => {
    const engine = fakeEngine();
    const { app, state } = build(engine);
    const pending = app(request('/api/start', 'POST'));
    engine.ready.reject(new Error('el motor no publicó su URL en 5s'));
    const response = await pending;
    expect(response.status).toBe(500);
    const failure = await body(response);
    expect(failure.ok).toBe(false);
    expect(failure.error).toBe('spawn_failed');
    expect(String(failure.detail)).toContain('no publicó su URL');
    expect(state.kills).toBe(1);
    expect(state.killedWith).toBe(engine.handle);

    const status = await body(await app(request('/api/status')));
    expect(status.engine).toBe('stopped');
    expect(status.engineUrl).toBeNull();
    expect(status.pid).toBeNull();
  });
});

describe('POST /api/stop', () => {
  test('kill → stopped with engineUrl null; stop again is already:true', async () => {
    const engine = fakeEngine();
    const { app, state } = build(engine);
    await start(app, engine);
    const response = await app(request('/api/stop', 'POST'));
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ ok: true, engine: 'stopped', engineUrl: null, pid: null });
    expect(state.kills).toBe(1);
    expect(state.killedWith).toBe(engine.handle);

    const again = await body(await app(request('/api/stop', 'POST')));
    expect(again.already).toBe(true);
    expect(state.kills).toBe(1);
  });

  test('kill failure → 500 kill_failed and the engine stays running', async () => {
    const engine = fakeEngine();
    const { app, state } = build(engine);
    state.killError = new Error('taskkill falló (exit 1)');
    await start(app, engine);
    const response = await app(request('/api/stop', 'POST'));
    expect(response.status).toBe(500);
    const failure = await body(response);
    expect(failure.ok).toBe(false);
    expect(failure.error).toBe('kill_failed');
    expect(String(failure.detail)).toContain('taskkill');

    const status = await body(await app(request('/api/status')));
    expect(status.engine).toBe('running');
    expect(status.engineUrl).toBe('http://127.0.0.1:41000');
  });

  test('stop when never started → already:true, no kill', async () => {
    const engine = fakeEngine();
    const { app, state } = build(engine);
    const status = await body(await app(request('/api/stop', 'POST')));
    expect(status.already).toBe(true);
    expect(state.kills).toBe(0);
  });
});

describe('engine crash watcher', () => {
  test('non-zero exit flips status to stopped and remembers the stderr tail', async () => {
    const engine = fakeEngine(4242, 'Trace: boom en el arranque');
    const { app } = build(engine);
    await start(app, engine);
    engine.exit.resolve({ exitCode: 1 });
    await new Promise(r => setTimeout(r, 5));

    const status = await body(await app(request('/api/status')));
    expect(status.engine).toBe('stopped');
    expect(status.engineUrl).toBeNull();
    expect(status.pid).toBeNull();
    expect(String(status.error)).toContain('Trace: boom en el arranque');
  });

  test('intentional stop does not record an error even with a non-zero exit', async () => {
    const engine = fakeEngine();
    const { app, state } = build(engine);
    await start(app, engine);
    state.killError = null;
    const response = await app(request('/api/stop', 'POST'));
    expect(response.status).toBe(200);
    const status = await body(await app(request('/api/status')));
    expect(status.engine).toBe('stopped');
    expect(status.error).toBeUndefined();
  });
});

describe('GET / (built UI)', () => {
  test('injects __HM_LAUNCHER__ + __HM_ROOT__ before </head> (with CORS)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hm-dist-'));
    try {
      const dist = join(dir, 'index.html');
      writeFileSync(dist, '<!doctype html><html><head><title>hm</title></head><body>panel</body></html>');
      const app = createLauncher(join(dir, 'harness-root'), {
        spawnEngine: () => fakeEngine().handle,
        killEngine: async () => {},
        distIndex: dist,
      });
      const response = await app(request('/'));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      const html = await response.text();
      expect(html).toContain('window.__HM_LAUNCHER__=true;');
      expect(html).toContain('harness-root');
      expect(html.indexOf('__HM_LAUNCHER__')).toBeLessThan(html.indexOf('</head>'));
    }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('missing dist → 503 build_missing (suite never depends on a build)', async () => {
    const app = createLauncher(ROOT, {
      spawnEngine: () => fakeEngine().handle,
      killEngine: async () => {},
      distIndex: join(tmpdir(), 'hm-does-not-exist', 'index.html'),
    });
    const response = await app(request('/'));
    expect(response.status).toBe(503);
    const failure = await body(response);
    expect(failure.ok).toBe(false);
    expect(failure.error).toBe('build_missing');
  });

  test('unknown API route → 404 not_found', async () => {
    const app = createLauncher(ROOT, {
      spawnEngine: () => fakeEngine().handle,
      killEngine: async () => {},
    });
    const failure = await body(await app(request('/api/nope')));
    expect(failure.error).toBe('not_found');
  });
});

describe('injectLauncherFlags', () => {
  test('inserts before </head>', () => {
    const html = injectLauncherFlags('<html><head><title>x</title></head><body></body></html>', 'C:\\roots\\demo');
    expect(html).toContain('window.__HM_LAUNCHER__=true;');
    expect(html.indexOf('__HM_LAUNCHER__')).toBeLessThan(html.indexOf('</head>'));
  });

  test('prepends when there is no head', () => {
    const html = injectLauncherFlags('<body>plain</body>', '/tmp/root');
    expect(html.startsWith('<script>window.__HM_LAUNCHER__')).toBe(true);
  });
});

describe('createOnlineLineFilter (launcher echoes the pairing URL)', () => {
  test('extracts complete Online: lines and passes other stdout through', () => {
    const filter = createOnlineLineFilter();
    expect(filter('Harness Manager sirviendo en http://127.0.0.1:41000\n')).toEqual([]);
    expect(filter('Online: https://demo.pages.dev/#c=ABCDEFGHJKMNPQRSTVWXYZ2345\n'))
      .toEqual(['Online: https://demo.pages.dev/#c=ABCDEFGHJKMNPQRSTVWXYZ2345']);
  });

  test('buffers a line split across chunks', () => {
    const filter = createOnlineLineFilter();
    expect(filter('Online: https://demo.pages.dev/#c=')).toEqual([]);
    expect(filter('ABCD\n')).toEqual(['Online: https://demo.pages.dev/#c=ABCD']);
  });

  test('handles CRLF and multiple Online lines (reconnect re-prints)', () => {
    const filter = createOnlineLineFilter();
    expect(filter('x\r\nOnline: a\r\nOnline: b\r\n')).toEqual(['Online: a', 'Online: b']);
    expect(filter('otra Online: no')).toEqual([]);
    expect(filter('\n')).toEqual([]);
  });
});

describe('engine CORS (launcher-origin page calls a cross-port engine)', () => {
  const app = createApp(FIXTURE);
  const engineRequest = async (path: string, init?: RequestInit): Promise<Response> => app(new Request(`http://127.0.0.1:41999${path}`, init));

  test('OPTIONS preflight → 204 with ACAO * and allow-headers', async () => {
    const response = await engineRequest('/api/action', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toContain('content-type');
  });

  test('GET /api/snapshot carries ACAO', async () => {
    const response = await engineRequest('/api/snapshot');
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('autoStart (--online)', () => {
  test('spawns the engine without an HTTP request and reaches running', async () => {
    const engine = fakeEngine();
    const { app, state } = build(engine, { autoStart: true });
    expect(state.spawns).toBe(1); // synchronous spawn during createLauncher
    engine.ready.resolve('http://127.0.0.1:41001');
    let status: Json = {};
    for (let i = 0; i < 50 && status.engine !== 'running'; i++) {
      status = await body(await app(request('/api/status')));
      await new Promise(r => setTimeout(r, 10));
    }
    expect(status).toMatchObject({ engine: 'running', engineUrl: 'http://127.0.0.1:41001', pid: 4242 });
  });

  test('without autoStart nothing spawns (local launcher flow unchanged)', () => {
    const engine = fakeEngine();
    const { state } = build(engine);
    expect(state.spawns).toBe(0);
  });
});
