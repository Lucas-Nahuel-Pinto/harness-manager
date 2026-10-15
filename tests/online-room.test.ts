import { describe, expect, test } from 'bun:test';
import { RoomLogic } from '../relay/src/room.ts';

const REQ = JSON.stringify({ id: 'r1', method: 'GET', path: '/api/snapshot' });
const RES = JSON.stringify({ id: 'r1', status: 200, body: { ok: true } });

function fakeMember(): { sent: string[], send: (text: string) => void } {
  const sent: string[] = [];
  return { sent, send: (text) => { sent.push(text); } };
}

function parsePresence(text: string): { v: number, t: string, members: Array<{ role: string }> } {
  const parsed: unknown = JSON.parse(text);
  return parsed as { v: number, t: string, members: Array<{ role: string }> };
}

describe('join / presence', () => {
  test('join returns a presence frame listing the member', () => {
    const room = new RoomLogic();
    const presence = parsePresence(room.join('e1', 'engine', fakeMember().send));
    expect(presence.v).toBe(1);
    expect(presence.t).toBe('presence');
    expect(presence.members).toEqual([{ role: 'engine' }]);
  });

  test('presence reflects the full member list', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    const presence = parsePresence(room.join('u1', 'ui', fakeMember().send));
    expect(presence.members).toEqual([{ role: 'engine' }, { role: 'ui' }]);
  });

  test('leave returns presence for the remaining members; last/unknown leave → null', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    room.join('u1', 'ui', fakeMember().send);

    expect(parsePresence(room.leave('u1') ?? '').members).toEqual([{ role: 'engine' }]);
    expect(room.leave('u1')).toBeNull();
    expect(room.leave('ghost')).toBeNull();
    expect(room.leave('e1')).toBeNull();
    expect(room.memberIds).toEqual([]);
  });
});

describe('handleFrame routing', () => {
  test('ui → engine (targeted)', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    room.join('u1', 'ui', fakeMember().send);
    expect(room.handleFrame('u1', REQ)).toEqual([{ toId: 'e1', text: REQ }]);
  });

  test('ui → every engine when two engines somehow exist is engine-only after supersede', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    room.join('u1', 'ui', fakeMember().send);
    room.join('e2', 'engine', fakeMember().send);
    expect(room.handleFrame('u1', REQ)).toEqual([{ toId: 'e2', text: REQ }]);
  });

  test('engine → all uis except sender', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    room.join('u1', 'ui', fakeMember().send);
    room.join('u2', 'ui', fakeMember().send);
    expect(room.handleFrame('e1', RES)).toEqual([
      { toId: 'u1', text: RES },
      { toId: 'u2', text: RES },
    ]);
  });

  test('engine → ui when no ui is present → nothing to send', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    expect(room.handleFrame('e1', RES)).toEqual([]);
  });

  test('malformed frames are dropped', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    room.join('u1', 'ui', fakeMember().send);
    expect(room.handleFrame('u1', 'not json {')).toEqual([]);
    expect(room.handleFrame('u1', '"string"')).toEqual([]);
    expect(room.handleFrame('u1', '[1,2]')).toEqual([]);
    expect(room.handleFrame('u1', '42')).toEqual([]);
  });

  test('presence-shaped input from a client is ignored', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    room.join('u1', 'ui', fakeMember().send);
    expect(room.handleFrame('u1', JSON.stringify({ v: 1, t: 'presence', members: [] }))).toEqual([]);
  });

  test('frames from unknown members are dropped', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    expect(room.handleFrame('ghost', REQ)).toEqual([]);
  });
});

describe('heartbeat routing (design 2026-10-15)', () => {
  const PING = JSON.stringify({ v: 1, t: 'ping' });
  const PONG = JSON.stringify({ v: 1, t: 'pong' });

  test('ping answers a pong to the sender only — never forwarded to other members', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    room.join('u1', 'ui', fakeMember().send);
    room.join('u2', 'ui', fakeMember().send);
    expect(room.handleFrame('u1', PING)).toEqual([{ toId: 'u1', text: PONG }]);
    expect(room.handleFrame('e1', PING)).toEqual([{ toId: 'e1', text: PONG }]);
  });

  test('a pong-shaped input from a client is dropped, not forwarded', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    room.join('u1', 'ui', fakeMember().send);
    expect(room.handleFrame('u1', PONG)).toEqual([]);
    expect(room.handleFrame('e1', PONG)).toEqual([]);
  });

  test('a ping from an unknown member is dropped', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    expect(room.handleFrame('ghost', PING)).toEqual([]);
  });

  test('presence-shaped input keeps being dropped alongside heartbeats', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    room.join('u1', 'ui', fakeMember().send);
    expect(room.handleFrame('u1', JSON.stringify({ v: 1, t: 'presence', members: [] }))).toEqual([]);
  });
});

describe('single engine per room', () => {
  test('second engine supersedes the first and presence fires', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    room.join('u1', 'ui', fakeMember().send);

    const presence = parsePresence(room.join('e2', 'engine', fakeMember().send));
    expect(presence.members).toEqual([{ role: 'ui' }, { role: 'engine' }]);
    expect(room.memberIds).toContain('e2');
    expect(room.memberIds).not.toContain('e1');

    expect(room.handleFrame('e1', REQ)).toEqual([]);
    expect(room.handleFrame('e2', REQ)).toEqual([{ toId: 'u1', text: REQ }]);
    expect(room.handleFrame('u1', REQ)).toEqual([{ toId: 'e2', text: REQ }]);
  });
});

describe('isIdle', () => {
  test('boundary: idle only after idleMs has elapsed without activity', () => {
    const room = new RoomLogic({ idleMs: 1000 });
    room.join('e1', 'engine', fakeMember().send);
    const last = room.lastActivity;

    expect(room.isIdle(last + 999)).toBe(false);
    expect(room.isIdle(last + 1000)).toBe(true);
    expect(room.isIdle(last + 5000)).toBe(true);
  });

  test('frames and leaves refresh the activity window', () => {
    const room = new RoomLogic({ idleMs: 1000 });
    room.join('e1', 'engine', fakeMember().send);
    const afterJoin = room.lastActivity;
    room.handleFrame('e1', REQ);
    expect(room.lastActivity).toBeGreaterThanOrEqual(afterJoin);
    room.leave('e1');
    expect(room.lastActivity).toBeGreaterThanOrEqual(afterJoin);
  });

  test('default window is 24h', () => {
    const room = new RoomLogic();
    room.join('e1', 'engine', fakeMember().send);
    const last = room.lastActivity;
    expect(room.isIdle(last + 24 * 60 * 60 * 1000 - 1)).toBe(false);
    expect(room.isIdle(last + 24 * 60 * 60 * 1000)).toBe(true);
  });
});
