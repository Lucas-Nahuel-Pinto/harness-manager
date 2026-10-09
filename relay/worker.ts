/**
 * Cloudflare entry — one Durable Object instance routing many rooms through the same pure
 *  `RoomLogic` that `relay/dev.ts` runs locally. Uses the WebSocket Hibernation API
 *  (`acceptWebSocket` / `webSocketMessage` / `webSocketClose`); membership survives DO eviction
 *  via `serializeAttachment` and is re-registered lazily on the next event.
 *  Join control frame (must be first message, mirrors dev.ts): {"v":1,"t":"join","room","role"}
 */
import type { MemberRole } from './src/room.ts';
import { parseJoin, RoomLogic } from './src/room.ts';

interface Env {
  ROOM: DurableObjectNamespace
}

interface SocketMeta {
  id: string
  roomId: string
  role: MemberRole
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export class Room {
  private readonly ctx: DurableObjectState;
  private readonly rooms = new Map<string, RoomLogic>();
  private readonly sockets = new Map<WebSocket, SocketMeta>();
  private alarmScheduled = false;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.ctx = ctx;
  }

  fetch(request: Request): Response {
    this.recover();
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('harness-manager relay (WebSocket only)', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    this.recover();
    const text = typeof message === 'string' ? message : String(message);
    let meta = this.sockets.get(ws);
    if (!meta) {
      const join = parseJoin(text);
      if (!join) { ws.close(4400, 'join required'); return; }
      meta = { id: crypto.randomUUID(), roomId: join.room, role: join.role };
      ws.serializeAttachment(meta);
      this.sockets.set(ws, meta);
      const room = this.ensureRoom(meta.roomId);
      this.broadcast(meta.roomId, room.join(meta.id, meta.role, outbound => this.safeSend(ws, outbound)));
      this.ensureAlarm();
      return;
    }
    const room = this.rooms.get(meta.roomId);
    if (!room) { return; }
    for (const out of room.handleFrame(meta.id, text)) {
      if (out.toId) { this.sendToMember(out.toId, out.text); }
      else { this.broadcast(meta.roomId, out.text); }
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.recover();
    this.removeSocket(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.recover();
    this.removeSocket(ws);
  }

  async alarm(): Promise<void> {
    this.alarmScheduled = false;
    this.recover();
    const now = Date.now();
    for (const [roomId, room] of [...this.rooms]) {
      if (!room.isIdle(now)) { continue; }
      for (const [ws, meta] of [...this.sockets]) {
        if (meta.roomId === roomId) { ws.close(4408, 'idle'); }
      }
      this.rooms.delete(roomId);
    }
    if (this.rooms.size > 0) { this.ensureAlarm(); }
  }

  /** Re-register sockets that survived DO hibernation (per-socket metadata lives in the attachment). */
  private recover(): void {
    const touched = new Map<string, string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (this.sockets.has(ws)) { continue; }
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      if (!meta) { continue; }
      this.sockets.set(ws, meta);
      const room = this.ensureRoom(meta.roomId);
      touched.set(meta.roomId, room.join(meta.id, meta.role, outbound => this.safeSend(ws, outbound)));
    }
    for (const [roomId, presence] of touched) { this.broadcast(roomId, presence); }
  }

  private ensureRoom(roomId: string): RoomLogic {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new RoomLogic();
      this.rooms.set(roomId, room);
    }
    return room;
  }

  private removeSocket(ws: WebSocket): void {
    const meta = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (!meta) { return; }
    const room = this.rooms.get(meta.roomId);
    if (!room) { return; }
    const presence = room.leave(meta.id);
    if (room.memberIds.length === 0) { this.rooms.delete(meta.roomId); return; }
    if (presence) { this.broadcast(meta.roomId, presence); }
  }

  private broadcast(roomId: string, text: string): void {
    for (const [ws, meta] of this.sockets) {
      if (meta.roomId === roomId) { this.safeSend(ws, text); }
    }
  }

  private sendToMember(memberId: string, text: string): void {
    for (const [ws, meta] of this.sockets) {
      if (meta.id === memberId) {
        this.safeSend(ws, text);
        return;
      }
    }
  }

  private safeSend(ws: WebSocket, text: string): void {
    try { ws.send(text); }
    catch { /* socket already closing — routing continues for the rest of the room */ }
  }

  private ensureAlarm(): void {
    if (this.alarmScheduled) { return; }
    this.alarmScheduled = true;
    void this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const stub = env.ROOM.get(env.ROOM.idFromName('relay'));
    return stub.fetch(request);
  },
};
