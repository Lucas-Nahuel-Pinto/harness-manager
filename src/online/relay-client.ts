/** Engine-side relay client: dials the relay as the `engine` member and dispatches decrypted `req` frames into the app handler. */

import type { ReqFrame, ResFrame } from './protocol.ts';
import { decryptFrame, deriveKey, encryptFrame } from './crypto.ts';
import { PAGES_URL, pairingUrl, RELAY_URL } from './pairing.ts';
import { decodePayload, isPresence } from './protocol.ts';

export type FetchHandler = (req: Request) => Response | Promise<Response>;

export interface RelayClientOptions {
  /** Relay WS endpoint, e.g. `ws://127.0.0.1:8788` or the production `wss://…/relay`. */
  relayUrl: string
  /** 26-char session code — derives room id + room key, never transmitted. */
  code: string
  /** Harness root, reported once in the unreachable-relay log (the handler already owns it). */
  rootAbs: string
  /** Usually `createApp(rootAbs)` — no new API surface, the relay path reuses the exact local routes. */
  fetchHandler: FetchHandler
  /** Fires on every successful (re)join with the printable pairing URL. */
  onConnect: (pairingUrl: string) => void
  /** Fires once per lost connection — the socket loop itself never throws. */
  onDisconnect: () => void
  log?: (msg: string) => void
}

export interface RelayClient {
  close: () => Promise<void>
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/** `--online [ws…]` slice of argv to forward to the engine; flag absent → `[]`. */
export function parseOnlineArgv(argv: readonly string[]): string[] {
  const index = argv.indexOf('--online');
  if (index === -1) { return []; }
  const tokens = ['--online'];
  const next = argv[index + 1];
  if (next !== undefined && next.startsWith('ws')) { tokens.push(next); }
  return tokens;
}

/** Effective relay URL when `--online` is present; `null` = flag absent (the relay must stay untouched). */
export function parseOnlineFlag(argv: readonly string[]): string | null {
  const tokens = parseOnlineArgv(argv);
  return tokens.length === 0 ? null : (tokens[1] ?? RELAY_URL);
}

/** 1s → 30s exponential backoff with ±25% jitter — jitter keeps many engines from reconnecting in lockstep after a relay restart. */
function reconnectDelay(attempt: number): number {
  const base = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

/** Join control frames are cleartext like presence; envelopes never carry a `t` field. */
function isJoinShaped(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) { return false; }
    return (parsed as { t?: unknown }).t === 'join';
  }
  catch {
    return false;
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text !== '' && (response.headers.get('content-type') ?? '').includes('application/json')) {
    try { return JSON.parse(text); }
    catch { /* header lies — hand the raw text back instead of failing the frame */ }
  }
  return text;
}

async function dispatch(frame: ReqFrame, fetchHandler: FetchHandler): Promise<ResFrame> {
  try {
    const headers: Record<string, string> = {};
    let body: string | undefined;
    if (frame.body !== undefined && frame.method === 'POST') {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(frame.body);
    }
    const response = await fetchHandler(new Request(`http://engine.local${frame.path}`, { method: frame.method, headers, body }));
    return { id: frame.id, status: response.status, body: await readBody(response) };
  }
  catch (error) {
    // A throwing handler must answer 500, never crash the socket loop.
    return { id: frame.id, status: 500, body: { error: error instanceof Error ? error.message : String(error) } };
  }
}

export function startRelayClient(options: RelayClientOptions): RelayClient {
  const log = options.log ?? console.log;
  const derived = deriveKey(options.code);
  const pairing = pairingUrl(PAGES_URL, options.code);

  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let connected = false;
  let failureLogged = false;
  let closed = false;

  function reportDown(): void {
    if (connected) {
      connected = false;
      failureLogged = true; // the outage is already reported via onDisconnect — retries stay silent
      options.onDisconnect();
    }
    else if (!failureLogged) {
      failureLogged = true;
      log(`relay inaccesible — reintentando… · root: ${options.rootAbs}`);
    }
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer !== null) { return; }
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void open();
    }, reconnectDelay(attempt));
  }

  function handleDown(ws: WebSocket): void {
    if (ws !== socket) { return; } // stale duplicate (error + close for the same socket)
    socket = null;
    reportDown();
    scheduleReconnect();
  }

  async function open(): Promise<void> {
    if (closed) { return; }
    try {
      const { room, key } = await derived;
      if (closed) { return; }
      const ws = new WebSocket(options.relayUrl);
      socket = ws;

      async function onMessage(text: string): Promise<void> {
        if (isPresence(text) || isJoinShaped(text)) { return; }
        let frame: ReqFrame | ResFrame;
        try {
          const payload = await decryptFrame(key, room, text);
          frame = decodePayload(JSON.stringify(payload) ?? '');
        }
        catch { return; } // wrong key, tampered, or non-req payload → dropped (spec §3)
        if (!('method' in frame)) { return; } // the engine only answers req frames
        const res = await dispatch(frame, options.fetchHandler);
        if (ws.readyState === WebSocket.OPEN) { ws.send(await encryptFrame(key, room, res)); }
      }

      ws.addEventListener('error', () => handleDown(ws));
      ws.addEventListener('close', () => handleDown(ws));
      ws.addEventListener('message', (event) => {
        void onMessage(String(event.data)).catch((error: unknown) => {
          log(`relay: frame descartada — ${error instanceof Error ? error.message : String(error)}`);
        });
      });
      ws.addEventListener('open', () => {
        if (closed || socket !== ws) { ws.close(); return; }
        ws.send(JSON.stringify({ v: 1, t: 'join', room, role: 'engine' }));
        attempt = 0;
        connected = true;
        failureLogged = false;
        options.onConnect(pairing);
      });
    }
    catch {
      socket = null;
      reportDown();
      scheduleReconnect();
    }
  }

  void open();

  return {
    async close() {
      closed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const ws = socket;
      socket = null;
      connected = false;
      if (!ws || ws.readyState === WebSocket.CLOSED) { return; }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        ws.addEventListener('close', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        try { ws.close(); }
        catch {
          clearTimeout(timer);
          resolve();
        }
      });
    },
  };
}
