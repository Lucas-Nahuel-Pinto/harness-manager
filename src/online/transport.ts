/**
 * API transport seam for the UI: `WSTransport` speaks the E2E relay protocol (spec §6) and is
 * the only implementation — the local `FetchTransport` fallback is gone (spec 2026-10-12).
 */

import type { ReqFrame, ResFrame } from './protocol.ts';
import { decryptFrame, deriveKey, encryptFrame } from './crypto.ts';
import { decodePayload, HEARTBEAT_MS, isControlShaped, isPresence, makeReqId, PING_FRAME, timeoutForPath } from './protocol.ts';

export type TransportStatus = 'connecting' | 'online' | 'offline';
export type ApiMethod = 'GET' | 'POST';

export interface Transport {
  api: <T>(method: ApiMethod, path: string, body?: unknown, timeoutMs?: number) => Promise<T>
  readonly status: TransportStatus
  onStatus: (cb: (status: TransportStatus) => void) => void
  close: () => void
}

export interface WSTransportOptions {
  /** Relay WS endpoint (committed `RELAY_URL`, or a `?relay=` override for local testing). */
  relayUrl: string
  /** 26-char session code — derives room id + room key, never transmitted. */
  code: string
  onStatus?: (status: TransportStatus) => void
  /** Agent (engine member) presence in the room — fired on every membership change. */
  onAgentPresence?: (present: boolean) => void
  /** Test seam — override the 25s keepalive cadence. */
  heartbeatMs?: number
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/** 1s → 30s exponential backoff with ±25% jitter — mirrors the engine side (Phase 2). */
function reconnectDelay(attempt: number): number {
  const base = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

export class WSTransport implements Transport {
  status: TransportStatus = 'connecting';

  private readonly pending = new Map<string, Pending>();
  private readonly statusListeners = new Set<(status: TransportStatus) => void>();
  private readonly presenceListeners = new Set<(present: boolean) => void>();
  private readonly derived: Promise<{ room: string, key: CryptoKey }>;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;
  private closed = false;
  /** Unknown until the first presence frame arrives (the relay broadcasts it right after join). */
  private agentKnown = false;
  private agentPresent = false;

  constructor(private readonly options: WSTransportOptions) {
    this.derived = deriveKey(options.code);
    if (options.onStatus) { this.statusListeners.add(options.onStatus); }
    if (options.onAgentPresence) { this.presenceListeners.add(options.onAgentPresence); }
    void this.open();
  }

  onStatus(cb: (status: TransportStatus) => void): void {
    this.statusListeners.add(cb);
  }

  private setStatus(next: TransportStatus): void {
    if (this.status === next) { return; }
    this.status = next;
    for (const cb of this.statusListeners) { cb(next); }
  }

  async api<T>(method: ApiMethod, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    // Fast-reject guard: no queueing while offline — callers get an error instead of hanging.
    if (this.status !== 'online' || this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error(this.status === 'connecting' ? 'conectando con el motor' : 'conexión perdida');
    }
    // The room is known to have no agent (presence frame said so): the relay would silently
    // drop the request and the caller would wait the whole budget for nothing.
    if (this.agentKnown && !this.agentPresent) {
      throw new Error('agente desconectado');
    }
    const { room, key } = await this.derived;
    const id = makeReqId();
    const frame: ReqFrame = body === undefined ? { id, method, path } : { id, method, path, body };
    const budget = timeoutMs ?? timeoutForPath(path);
    return new Promise<T>((resolve, reject) => {
      const entry: Pending = {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer: setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('timeout'));
        }, budget),
      };
      this.pending.set(id, entry);
      void encryptFrame(key, room, frame).then(
        (envelope) => {
          if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(envelope);
          }
          else {
            this.settle(id, new Error('conexión perdida'));
          }
        },
        () => this.settle(id, new Error('conexión perdida')),
      );
    });
  }

  private settle(id: string, error: Error): void {
    const entry = this.pending.get(id);
    if (!entry) { return; }
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.reject(error);
  }

  private rejectAllPending(error: Error): void {
    const entries = [...this.pending.values()];
    this.pending.clear(); // clear first so a rejection handler cannot re-enter pending state
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  private async onMessage(text: string): Promise<void> {
    if (isPresence(text)) { this.handlePresence(text); return; }
    if (isControlShaped(text)) { return; }
    const { room, key } = await this.derived;
    let frame: ReqFrame | ResFrame;
    try {
      const payload = await decryptFrame(key, room, text);
      frame = decodePayload(JSON.stringify(payload));
    }
    catch {
      return; // wrong key, tampered, or malformed → dropped (spec §3)
    }
    if (!('status' in frame)) { return; } // the UI only awaits res frames
    const entry = this.pending.get(frame.id);
    if (!entry) { return; } // another tab's id or already timed out — no leak
    clearTimeout(entry.timer);
    this.pending.delete(frame.id);
    entry.resolve(frame.body);
  }

  /**
   * Cleartext presence frame: track whether an engine (agent) member is in the room. When the
   * agent leaves, in-flight requests can never be answered (the relay drops them silently) —
   * reject them immediately instead of letting callers wait out the whole budget.
   */
  private handlePresence(text: string): void {
    let present = false;
    try {
      const parsed: unknown = JSON.parse(text);
      const frame = parsed as { members?: unknown };
      if (!Array.isArray(frame.members)) { return; }
      present = (frame.members as Array<{ role?: unknown }>).some(member => member?.role === 'engine');
    }
    catch {
      return;
    }
    if (this.agentKnown && present === this.agentPresent) { return; }
    this.agentKnown = true;
    this.agentPresent = present;
    if (!present) { this.rejectAllPending(new Error('agente desconectado')); }
    for (const cb of this.presenceListeners) { cb(present); }
  }

  private handleDown(ws: WebSocket): void {
    if (ws !== this.socket) { return; } // stale duplicate (error + close for the same socket)
    this.socket = null;
    this.stopHeartbeat();
    this.rejectAllPending(new Error('conexión perdida'));
    this.setStatus('offline');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) { return; }
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, reconnectDelay(this.attempt));
  }

  private async open(): Promise<void> {
    if (this.closed) { return; }
    this.setStatus('connecting');
    try {
      const { room } = await this.derived;
      if (this.closed) { return; }
      const ws = new WebSocket(this.options.relayUrl);
      this.socket = ws;

      ws.addEventListener('error', () => this.handleDown(ws));
      ws.addEventListener('close', () => this.handleDown(ws));
      ws.addEventListener('message', (event) => {
        void this.onMessage(String(event.data)).catch(() => { /* undecryptable frame → dropped */ });
      });
      ws.addEventListener('open', () => {
        if (this.closed || this.socket !== ws) { ws.close(); return; }
        ws.send(JSON.stringify({ v: 1, t: 'join', room, role: 'ui' }));
        this.startHeartbeat(ws);
        this.attempt = 0;
        this.setStatus('online');
      });
    }
    catch {
      this.socket = null;
      this.setStatus('offline');
      this.scheduleReconnect();
    }
  }

  /**
   * Keepalive: a cleartext ping every HEARTBEAT_MS keeps the idle relay socket alive (design
   * 2026-10-15). Only the socket that armed the timer may send — reconnects re-arm it.
   */
  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.closed || this.socket !== ws || ws.readyState !== WebSocket.OPEN) { return; }
      ws.send(PING_FRAME);
    }, this.options.heartbeatMs ?? HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.socket;
    this.socket = null;
    this.rejectAllPending(new Error('conexión perdida'));
    this.setStatus('offline');
    try { ws?.close(); }
    catch { /* already closed */ }
  }
}
