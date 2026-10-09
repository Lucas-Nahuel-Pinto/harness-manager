/**
 * Local dev relay — Bun WS server running the SAME routing semantics the Cloudflare Durable Object uses in Phase 4.
 *
 * Control frame (cleartext, never encrypted), MUST be the first message from every client:
 *   {"v":1,"t":"join","room":"<64-hex room id>","role":"engine"|"ui"}
 * It carries only the room hash (never the session code/key). Any other first message → close 4400.
 * After joining, every message is an opaque room frame routed by `RoomLogic`.
 */
import type { ServerWebSocket } from 'bun';
import { parseJoin, RoomLogic } from './src/room.ts';

interface WsData {
  id: string
  roomId?: string
}

export interface DevRelay {
  port: number
  stop: () => void
}

export function startDevRelay(port: number): DevRelay {
  const rooms = new Map<string, RoomLogic>();
  const sockets = new Map<string, ServerWebSocket<WsData>>();

  function emit(room: RoomLogic, text: string): void {
    for (const id of room.memberIds) { sockets.get(id)?.send(text); }
  }

  const server = Bun.serve<WsData>({
    hostname: '127.0.0.1',
    port,
    fetch(request, srv) {
      if (srv.upgrade(request, { data: { id: crypto.randomUUID() } })) { return undefined; }
      return new Response('harness-manager dev relay (WebSocket only)', { status: 426 });
    },
    websocket: {
      message(ws, message) {
        const text = typeof message === 'string' ? message : String(message);
        if (!ws.data.roomId) {
          const join = parseJoin(text);
          if (!join) { ws.close(4400, 'join required'); return; }
          ws.data.roomId = join.room;
          let room = rooms.get(join.room);
          if (!room) {
            room = new RoomLogic();
            rooms.set(join.room, room);
          }
          sockets.set(ws.data.id, ws);
          emit(room, room.join(ws.data.id, join.role, outbound => ws.send(outbound)));
          return;
        }
        const room = rooms.get(ws.data.roomId);
        if (!room) { return; }
        for (const out of room.handleFrame(ws.data.id, text)) {
          if (out.toId) { sockets.get(out.toId)?.send(out.text); }
          else { emit(room, out.text); }
        }
      },
      close(ws) {
        sockets.delete(ws.data.id);
        const roomId = ws.data.roomId;
        if (!roomId) { return; }
        const room = rooms.get(roomId);
        if (!room) { return; }
        const presence = room.leave(ws.data.id);
        if (room.memberIds.length === 0) { rooms.delete(roomId); return; }
        if (presence) { emit(room, presence); }
      },
    },
  });

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()]) {
      if (!room.isIdle(now)) { continue; }
      for (const id of room.memberIds) { sockets.get(id)?.close(4408, 'idle'); }
    }
  }, 60 * 60 * 1000);

  return {
    port: server.port ?? port,
    stop() {
      clearInterval(sweep);
      void server.stop(true);
    },
  };
}

if (import.meta.main) {
  const relay = startDevRelay(Number.parseInt(process.env.HM_DEV_RELAY_PORT ?? '', 10) || 8788);
  process.on('SIGINT', () => {
    relay.stop();
    process.exit(0);
  });
}
