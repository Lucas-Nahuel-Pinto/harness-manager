import type { DevRelay } from '../relay/dev.ts';
import type { ReqFrame, ResFrame } from '../src/online/protocol.ts';
import type { FetchHandler } from '../src/online/relay-client.ts';
import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { startDevRelay } from '../relay/dev.ts';
import { decryptFrame, deriveKey, encryptFrame } from '../src/online/crypto.ts';
import { generateCode, PAGES_URL, pairingUrl } from '../src/online/pairing.ts';
import { decodePayload, isPresence } from '../src/online/protocol.ts';
import { startRelayClient } from '../src/online/relay-client.ts';
import { createApp } from '../src/server/app.ts';

const FIXTURE = resolve(import.meta.dir, 'fixtures', 'mini-harness');
const REPO_ROOT = resolve(import.meta.dir, '..');

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) { throw new Error(`timeout esperando: ${label}`); }
    await sleep(25);
  }
}

function relayUrl(port: number): string {
  return `ws://127.0.0.1:${port}`;
}

async function startRelayOn(port: number): Promise<DevRelay> {
  for (let i = 0; i < 40; i++) {
    try { return startDevRelay(port); }
    catch { await sleep(50); }
  }
  throw new Error(`el relay no pudo reusar el puerto ${port}`);
}

interface FakeUi {
  joined: Promise<void>
  request: (req: ReqFrame) => Promise<ResFrame>
  close: () => void
}

/** Scripted fake UI: joins the room as `ui`, waits until a presence frame shows the engine is a member. */
async function connectUi(url: string, code: string): Promise<FakeUi> {
  const { room, key } = await deriveKey(code);
  const ws = new WebSocket(url);
  const pending = new Map<string, (frame: ResFrame) => void>();
  let resolveJoined!: () => void;
  const joined = new Promise<void>((r) => { resolveJoined = r; });

  ws.addEventListener('message', (event) => {
    const text = String(event.data);
    if (isPresence(text)) {
      try {
        const frame = JSON.parse(text) as { members?: Array<{ role?: string }> };
        if ((frame.members ?? []).some(member => member.role === 'engine')) { resolveJoined(); }
      }
      catch { /* malformed presence → keep waiting */ }
      return;
    }
    void (async () => {
      const payload = await decryptFrame(key, room, text);
      const frame = decodePayload(JSON.stringify(payload));
      if ('status' in frame) { pending.get(frame.id)?.(frame); }
    })().catch(() => { /* undecryptable frame → drop */ });
  });

  await new Promise<void>((r) => { ws.addEventListener('open', () => r(), { once: true }); });
  ws.send(JSON.stringify({ v: 1, t: 'join', room, role: 'ui' }));

  return {
    joined,
    async request(req: ReqFrame): Promise<ResFrame> {
      return new Promise<ResFrame>((resolvePromise, reject) => {
        const timer = setTimeout(() => {
          pending.delete(req.id);
          reject(new Error(`sin res para ${req.id}`));
        }, 5000);
        pending.set(req.id, (frame) => {
          clearTimeout(timer);
          pending.delete(req.id);
          resolvePromise(frame);
        });
        void encryptFrame(key, room, req)
          .then(envelope => ws.send(envelope))
          .catch(reject);
      });
    },
    close: () => ws.close(),
  };
}

interface EngineProc {
  out: () => string
  kill: () => void
  waitExit: () => Promise<number>
}

function drainText(stream: ReadableStream<Uint8Array>, onChunk: (text: string) => void): void {
  void (async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { return; }
        onChunk(decoder.decode(value, { stream: true }));
      }
    }
    catch { /* closed */ }
  })();
}

async function spawnEngine(args: string[]): Promise<EngineProc> {
  const proc = Bun.spawn(['bun', 'server.ts', '--root', FIXTURE, '--port', '0', ...args], {
    cwd: REPO_ROOT,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let out = '';
  drainText(proc.stdout, (chunk) => { out += chunk; });
  drainText(proc.stderr, () => {});
  const kill = (): void => {
    if (proc.exitCode !== null) { return; }
    if (process.platform === 'win32') {
      Bun.spawnSync(['taskkill', '/pid', String(proc.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' });
    }
    else {
      proc.kill('SIGKILL');
    }
  };
  return { out: () => out, kill, waitExit: async () => proc.exited };
}

describe('relay client ↔ dev relay integration', () => {
  test('GET /api/snapshot roundtrip through the real createApp', async () => {
    const relay = startDevRelay(0);
    const code = generateCode();
    const url = relayUrl(relay.port);
    const client = startRelayClient({
      relayUrl: url,
      code,
      rootAbs: FIXTURE,
      fetchHandler: createApp(FIXTURE),
      onConnect: () => {},
      onDisconnect: () => {},
      log: () => {},
    });
    try {
      const ui = await connectUi(url, code);
      await ui.joined;
      const res = await ui.request({ id: 'req-snapshot', method: 'GET', path: '/api/snapshot' });
      expect(res.id).toBe('req-snapshot');
      expect(res.status).toBe(200);
      const body = res.body as { ok: boolean, snapshot?: { schemaVersion?: number, meta?: { root?: string } } };
      expect(body.ok).toBe(true);
      expect(body.snapshot?.schemaVersion).toBe(1);
      expect(body.snapshot?.meta?.root).toContain('mini-harness');
      ui.close();
    }
    finally {
      await client.close();
      relay.stop();
    }
  }, 15000);

  test('POST dispatch carries method, path and JSON body to the handler', async () => {
    const relay = startDevRelay(0);
    const code = generateCode();
    const url = relayUrl(relay.port);
    const received: Array<{ method: string, path: string, contentType: string | null, body: unknown }> = [];
    const handler: FetchHandler = async (request) => {
      received.push({
        method: request.method,
        path: new URL(request.url).pathname,
        contentType: request.headers.get('content-type'),
        body: await request.json(),
      });
      return new Response(JSON.stringify({ ok: true, echoed: true }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = startRelayClient({
      relayUrl: url,
      code,
      rootAbs: FIXTURE,
      fetchHandler: handler,
      onConnect: () => {},
      onDisconnect: () => {},
      log: () => {},
    });
    try {
      const ui = await connectUi(url, code);
      await ui.joined;
      const res = await ui.request({
        id: 'req-post',
        method: 'POST',
        path: '/api/action',
        body: { kind: 'mcp-toggle', enabled: true },
      });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true, echoed: true });
      expect(received).toEqual([{
        method: 'POST',
        path: '/api/action',
        contentType: 'application/json',
        body: { kind: 'mcp-toggle', enabled: true },
      }]);
      ui.close();
    }
    finally {
      await client.close();
      relay.stop();
    }
  }, 15000);

  test('a throwing handler answers 500 and the socket loop survives', async () => {
    const relay = startDevRelay(0);
    const code = generateCode();
    const url = relayUrl(relay.port);
    let calls = 0;
    const handler: FetchHandler = async () => {
      calls += 1;
      if (calls === 1) { throw new Error('boom del handler'); }
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
    };
    const client = startRelayClient({
      relayUrl: url,
      code,
      rootAbs: FIXTURE,
      fetchHandler: handler,
      onConnect: () => {},
      onDisconnect: () => {},
      log: () => {},
    });
    try {
      const ui = await connectUi(url, code);
      await ui.joined;
      const first = await ui.request({ id: 'req-boom', method: 'GET', path: '/api/snapshot' });
      expect(first.status).toBe(500);
      expect(first.body).toEqual({ error: 'boom del handler' });

      const second = await ui.request({ id: 'req-after', method: 'GET', path: '/api/snapshot' });
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ ok: true });
      ui.close();
    }
    finally {
      await client.close();
      relay.stop();
    }
  }, 15000);

  test('relay restart → onDisconnect fires, then onConnect re-fires after backoff', async () => {
    const first = startDevRelay(0);
    const port = first.port;
    const events: string[] = [];
    const client = startRelayClient({
      relayUrl: relayUrl(port),
      code: generateCode(),
      rootAbs: FIXTURE,
      fetchHandler: createApp(FIXTURE),
      onConnect: () => { events.push('connect'); },
      onDisconnect: () => { events.push('disconnect'); },
      log: () => {},
    });
    let second: DevRelay | null = null;
    try {
      await waitFor(() => events.includes('connect'), 3000, 'primer connect');
      first.stop();
      await waitFor(() => events.includes('disconnect'), 3000, 'onDisconnect tras caer el relay');
      second = await startRelayOn(port);
      await waitFor(() => events.filter(e => e === 'connect').length >= 2, 8000, 'reconnect');
      expect(events).toEqual(['connect', 'disconnect', 'connect']);
    }
    finally {
      await client.close();
      second?.stop();
      first.stop();
    }
  }, 20000);

  test('onConnect carries exactly pairingUrl(PAGES_URL, code)', async () => {
    const relay = startDevRelay(0);
    const code = generateCode();
    const seen: string[] = [];
    const client = startRelayClient({
      relayUrl: relayUrl(relay.port),
      code,
      rootAbs: FIXTURE,
      fetchHandler: createApp(FIXTURE),
      onConnect: (url) => { seen.push(url); },
      onDisconnect: () => {},
      log: () => {},
    });
    try {
      await waitFor(() => seen.length > 0, 3000, 'onConnect con la URL de pairing');
      expect(seen.length).toBe(1);
      expect(seen[0]).toBe(pairingUrl(PAGES_URL, code));
      expect(seen[0]).toBe(`${PAGES_URL}/#c=${code}`);
      expect(seen[0]).toMatch(/#c=[A-Z2-7]{26}$/);
    }
    finally {
      await client.close();
      relay.stop();
    }
  }, 10000);
});

describe('engine entry wiring (loopback-only diagnostic)', () => {
  test('ready line, zero relay output — the online path belongs to agent.ts', async () => {
    const engine = await spawnEngine([]);
    try {
      await waitFor(() => /sirviendo en http:\/\/127\.0\.0\.1:\d+/.test(engine.out()), 8000, 'ready del motor');
      await sleep(400); // ventana para cualquier log tardío que un bug de wiring pudiera emitir
      const out = engine.out();
      expect(out).toContain('Harness Manager sirviendo en http://127.0.0.1:');
      expect(out).toContain(`root: ${FIXTURE}`);
      expect(out).not.toContain('Online:');
      expect(out.toLowerCase()).not.toContain('relay');
      expect(out.toLowerCase()).not.toContain('inaccesible');
    }
    finally {
      engine.kill();
      await engine.waitExit();
    }
  }, 20000);
});
