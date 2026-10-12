import type { DevRelay } from '../relay/dev.ts';
import type { FetchHandler } from '../src/online/relay-client.ts';
import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { startDevRelay } from '../relay/dev.ts';
import { deriveKey } from '../src/online/crypto.ts';
import { generateCode } from '../src/online/pairing.ts';
import { startRelayClient } from '../src/online/relay-client.ts';
import { FetchTransport, WSTransport } from '../src/online/transport.ts';
import { createApp } from '../src/server/app.ts';

const FIXTURE = resolve(import.meta.dir, 'fixtures', 'mini-harness');

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

/** True when `promise` rejects with an error whose message contains `needle`. */
async function rejectsWith(promise: Promise<unknown>, needle: string): Promise<boolean> {
  try {
    await promise;
    return false;
  }
  catch (error) {
    return error instanceof Error && error.message.includes(needle);
  }
}

async function startRelayOn(port: number): Promise<DevRelay> {
  for (let i = 0; i < 40; i++) {
    try { return startDevRelay(port); }
    catch { await sleep(50); }
  }
  throw new Error(`el relay no pudo reusar el puerto ${port}`);
}

/** Raw ws member that joins as engine and never answers — keeps requests pending on purpose. */
async function joinSilentEngine(url: string, code: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((r) => { ws.addEventListener('open', () => r(), { once: true }); });
  const { room } = await deriveKey(code);
  ws.send(JSON.stringify({ v: 1, t: 'join', room, role: 'engine' }));
  return ws;
}

/** Engine side of the room: dispatches decrypted req frames through the real createApp. */
function startEngine(relay: string, code: string, handler: FetchHandler = createApp(FIXTURE)): { close: () => Promise<void> } {
  const client = startRelayClient({
    relayUrl: relay,
    code,
    rootAbs: FIXTURE,
    fetchHandler: handler,
    onConnect: () => {},
    onDisconnect: () => {},
    log: () => {},
  });
  return { close: async () => client.close() };
}

/** Snapshot via the transport, retrying while the engine member re-joins the room (2s per attempt). */
async function snapshotWhenReady(transport: WSTransport, deadlineMs: number): Promise<{ ok: boolean, snapshot?: { meta?: { root?: string } } }> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      return await transport.api('GET', '/api/snapshot', undefined, 2000);
    }
    catch (error) {
      if (Date.now() > deadline) { throw error; }
      await sleep(150);
    }
  }
}

describe('WSTransport ↔ dev relay integration', () => {
  test('GET roundtrip: encrypted req → engine → decrypted res resolves the snapshot', async () => {
    const relay = startDevRelay(0);
    const code = generateCode();
    const engine = startEngine(relayUrl(relay.port), code);
    const transport = new WSTransport({ relayUrl: relayUrl(relay.port), code });
    try {
      expect(transport.status).toBe('connecting');
      await waitFor(() => transport.status === 'online', 5000, 'transport online');
      const body = await snapshotWhenReady(transport, 8000);
      expect(body.ok).toBe(true);
      expect(body.snapshot?.meta?.root).toContain('mini-harness');
    }
    finally {
      transport.close();
      await engine.close();
      relay.stop();
    }
  }, 15000);

  test('POST roundtrip: method, path and JSON body reach the handler verbatim', async () => {
    const relay = startDevRelay(0);
    const code = generateCode();
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
    const engine = startEngine(relayUrl(relay.port), code, handler);
    const transport = new WSTransport({ relayUrl: relayUrl(relay.port), code });
    try {
      await waitFor(() => transport.status === 'online', 5000, 'transport online');
      const body = await transport.api<{ ok: boolean, echoed: boolean }>('POST', '/api/action', { kind: 'mcp-toggle', enabled: true });
      expect(body).toEqual({ ok: true, echoed: true });
      expect(received).toEqual([{
        method: 'POST',
        path: '/api/action',
        contentType: 'application/json',
        body: { kind: 'mcp-toggle', enabled: true },
      }]);
    }
    finally {
      transport.close();
      await engine.close();
      relay.stop();
    }
  }, 15000);

  test('pending request with a tiny budget rejects with timeout', async () => {
    const relay = startDevRelay(0);
    const code = generateCode();
    let agentUp = false;
    const transport = new WSTransport({ relayUrl: relayUrl(relay.port), code, onAgentPresence: (p) => { agentUp = p; } });
    const engine = await joinSilentEngine(relayUrl(relay.port), code); // present, never answers
    try {
      await waitFor(() => transport.status === 'online' && agentUp, 5000, 'transport online + engine presente');
      expect(await rejectsWith(transport.api('GET', '/api/snapshot', undefined, 120), 'timeout')).toBe(true);
      expect(transport.status).toBe('online'); // a timeout must not take the socket down
    }
    finally {
      engine.close();
      transport.close();
      relay.stop();
    }
  }, 10000);

  test('socket close rejects every pending request with "conexión perdida" and flips offline', async () => {
    const relay = startDevRelay(0);
    const code = generateCode();
    let agentUp = false;
    const transport = new WSTransport({ relayUrl: relayUrl(relay.port), code, onAgentPresence: (p) => { agentUp = p; } });
    const engine = await joinSilentEngine(relayUrl(relay.port), code); // present, never answers
    try {
      await waitFor(() => transport.status === 'online' && agentUp, 5000, 'transport online + engine presente');
      const pending = transport.api('GET', '/api/snapshot', undefined, 5000);
      const outcome = rejectsWith(pending, 'conexión perdida'); // rejection handler attached immediately
      await sleep(50); // let the encrypted frame leave the socket
      relay.stop();
      await waitFor(() => transport.status === 'offline', 3000, 'offline tras caer el relay');
      expect(await outcome).toBe(true);
    }
    finally {
      engine.close();
      transport.close();
      relay.stop();
    }
  }, 10000);

  test('relay restart: offline → reconnect re-joins and the roundtrip works again', async () => {
    const first = startDevRelay(0);
    const port = first.port;
    const code = generateCode();
    const engine = startEngine(relayUrl(port), code);
    const statuses: string[] = [];
    const transport = new WSTransport({ relayUrl: relayUrl(port), code, onStatus: s => statuses.push(s) });
    let second: DevRelay | null = null;
    try {
      await waitFor(() => transport.status === 'online', 5000, 'primer online');
      const firstBody = await snapshotWhenReady(transport, 8000);
      expect(firstBody.ok).toBe(true);

      first.stop();
      await waitFor(() => transport.status === 'offline', 3000, 'offline tras caer el relay');
      second = await startRelayOn(port);
      await waitFor(() => transport.status === 'online', 8000, 'reconnect del transport');

      const secondBody = await snapshotWhenReady(transport, 12000); // engine re-joins on its own backoff
      expect(secondBody.ok).toBe(true);
      // cycle: online → offline → (possible failed retries) → online again
      expect(statuses[0]).toBe('online');
      expect(statuses).toContain('offline');
      expect(statuses.at(-1)).toBe('online');
      expect(statuses.filter(s => s === 'online').length).toBeGreaterThanOrEqual(2);
    }
    finally {
      transport.close();
      await engine.close();
      second?.stop();
      first.stop();
    }
  }, 30000);

  test('presence broadcasts while the engine is present leave the pending map untouched', async () => {
    const relay = startDevRelay(0);
    const code = generateCode();
    const url = relayUrl(relay.port);
    let agentUp = false;
    const transport = new WSTransport({ relayUrl: url, code, onAgentPresence: (present) => { agentUp = present; } });
    let engine: WebSocket | null = null;
    let intruder: WebSocket | null = null;
    try {
      // The engine member must be in the room: with it present, other members joining/leaving
      // only change the ui roster and must never settle the pending request.
      engine = await joinSilentEngine(url, code);
      await waitFor(() => transport.status === 'online' && agentUp, 5000, 'transport online + engine presente');
      const { room } = await deriveKey(code);

      const pending = transport.api('GET', '/api/snapshot', undefined, 3000);
      let settled = false;
      void pending.catch(() => { settled = true; });

      // A second UI joins the room → presence broadcasts land on the transport mid-request.
      intruder = new WebSocket(url);
      await new Promise<void>((r) => { intruder!.addEventListener('open', () => r(), { once: true }); });
      intruder.send(JSON.stringify({ v: 1, t: 'join', room, role: 'ui' }));
      await sleep(300);
      expect(settled).toBe(false); // presence/control must not resolve or reject the pending req

      transport.close();
      expect(await rejectsWith(pending, 'conexión perdida')).toBe(true);
    }
    finally {
      try { intruder?.close(); }
      catch { /* already closed */ }
      try { engine?.close(); }
      catch { /* already closed */ }
      transport.close();
      relay.stop();
    }
  }, 10000);

  test('agent presence: engine join/leave notifies; agent gone rejects pending and fast-fails api', async () => {
    const relay = startDevRelay(0);
    const code = generateCode();
    const url = relayUrl(relay.port);
    const seen: boolean[] = [];
    const transport = new WSTransport({ relayUrl: url, code, onAgentPresence: p => seen.push(p) });
    let engine: WebSocket | null = null;
    try {
      await waitFor(() => transport.status === 'online', 5000, 'transport online');
      // The relay broadcasts presence right after the ui joins: empty room → false.
      await waitFor(() => seen.length > 0, 5000, 'presence inicial');
      expect(seen).toEqual([false]);

      // Engine joins → notification; a request now travels (this engine never answers).
      engine = await joinSilentEngine(url, code);
      await waitFor(() => seen.at(-1) === true, 5000, 'agente presente');
      const pending = transport.api('GET', '/api/snapshot', undefined, 3000);

      // Engine leaves → the relay would drop the request silently; the transport fails it fast.
      engine.close();
      engine = null;
      expect(await rejectsWith(pending, 'agente desconectado')).toBe(true);
      await waitFor(() => seen.at(-1) === false, 5000, 'agente ausente');
      // New calls with no agent in the room reject instantly (no budget wait).
      expect(await rejectsWith(transport.api('GET', '/api/snapshot', undefined, 3000), 'agente desconectado')).toBe(true);
    }
    finally {
      try { engine?.close(); }
      catch { /* already closed */ }
      transport.close();
      relay.stop();
    }
  }, 15000);

  test('closed transport: status offline, onStatus fires, api rejects fast', async () => {
    const relay = startDevRelay(0);
    const statuses: string[] = [];
    const transport = new WSTransport({ relayUrl: relayUrl(relay.port), code: generateCode(), onStatus: s => statuses.push(s) });
    await waitFor(() => transport.status === 'online', 5000, 'transport online');
    transport.close();
    expect(transport.status).toBe('offline');
    expect(statuses).toEqual(['online', 'offline']);
    expect(await rejectsWith(transport.api('GET', '/api/snapshot'), 'conexión perdida')).toBe(true);
    relay.stop();
  }, 10000);
});

describe('FetchTransport delegation (the local seam, byte-identical)', () => {
  test('GET/POST keep the URL join, JSON body headers and non-JSON error', async () => {
    const received: Array<{ method: string, path: string, contentType: string | null, body: unknown }> = [];
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const { pathname } = new URL(request.url);
        if (pathname === '/api/not-json') {
          return new Response('plain text', { status: 502, statusText: 'Bad Gateway' });
        }
        received.push({
          method: request.method,
          path: pathname,
          contentType: request.headers.get('content-type'),
          body: request.method === 'POST' ? await request.json() : null,
        });
        return new Response(JSON.stringify({ ok: true, path: pathname }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    try {
      const transport = new FetchTransport(() => `http://127.0.0.1:${server.port}`);
      expect(transport.status).toBe('online');
      expect(await transport.api<{ ok: boolean, path: string }>('GET', '/api/snapshot')).toEqual({ ok: true, path: '/api/snapshot' });
      expect(await transport.api<{ ok: boolean, path: string }>('POST', '/api/action', { kind: 'mcp-toggle' })).toEqual({ ok: true, path: '/api/action' });
      expect(received).toEqual([
        { method: 'GET', path: '/api/snapshot', contentType: null, body: null },
        { method: 'POST', path: '/api/action', contentType: 'application/json', body: { kind: 'mcp-toggle' } },
      ]);
      expect(await rejectsWith(transport.api('GET', '/api/not-json'), 'respuesta no JSON (502 Bad Gateway)')).toBe(true);
      transport.onStatus(() => { throw new Error('no debe notificar'); });
      transport.close();
    }
    finally {
      await server.stop(true);
    }
  });
});
