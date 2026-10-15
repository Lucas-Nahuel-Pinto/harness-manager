/**
 * Pure room routing for online mode — shared by `relay/dev.ts` and (Phase 4) the Cloudflare Durable Object.
 *  Self-contained on purpose: no app/ or cloudflare:workers imports, so it runs under Bun tests and bundles anywhere.
 */

export type MemberRole = 'engine' | 'ui';

export interface RoomMember {
  role: MemberRole
  send: (text: string) => void
}

export interface RoomOut {
  /** Target member id; omitted → broadcast to every current member. */
  toId?: string
  text: string
}

export interface RoomOptions {
  /** Idle expiry window (default 24h, spec §3). */
  idleMs?: number
}

const DEFAULT_IDLE_MS = 24 * 60 * 60 * 1000;

export interface JoinFrame {
  room: string
  role: MemberRole
}

/** Parse the join control frame (first message from every client); anything else → null. */
export function parseJoin(text: string): JoinFrame | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) { return null; }
    const frame = parsed as { v?: unknown, t?: unknown, room?: unknown, role?: unknown };
    if (frame.v !== 1 || frame.t !== 'join') { return null; }
    if (typeof frame.room !== 'string' || !/^[0-9a-f]{64}$/.test(frame.room)) { return null; }
    if (frame.role !== 'engine' && frame.role !== 'ui') { return null; }
    return { room: frame.room, role: frame.role };
  }
  catch {
    return null;
  }
}

const PONG_FRAME = JSON.stringify({ v: 1, t: 'pong' });

/**
 * Heartbeat control frames (cleartext like join/presence): a `ping` is answered with a pong to
 * the sender only, a `pong` from a client is swallowed (design 2026-10-15).
 */
function heartbeatKind(text: string): 'ping' | 'pong' | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) { return null; }
    const frame = parsed as { v?: unknown, t?: unknown };
    if (frame.v !== 1) { return null; }
    if (frame.t === 'ping') { return 'ping'; }
    if (frame.t === 'pong') { return 'pong'; }
    return null;
  }
  catch {
    return null;
  }
}

function isPresenceShaped(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) { return false; }
    const frame = parsed as { v?: unknown, t?: unknown };
    return frame.v === 1 && frame.t === 'presence';
  }
  catch {
    return false;
  }
}

function isForwardable(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  }
  catch {
    return false;
  }
}

export class RoomLogic {
  private readonly idleMs: number;
  private readonly members = new Map<string, RoomMember>();
  private activity: number;

  constructor(opts: RoomOptions = {}) {
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this.activity = Date.now();
  }

  get memberIds(): string[] {
    return [...this.members.keys()];
  }

  get lastActivity(): number {
    return this.activity;
  }

  /** Register a member; returns the presence frame to broadcast. A new engine supersedes any previous engine. */
  join(id: string, role: MemberRole, send: (text: string) => void): string {
    if (role === 'engine') {
      for (const [otherId, member] of this.members) {
        if (otherId !== id && member.role === 'engine') { this.members.delete(otherId); }
      }
    }
    this.members.set(id, { role, send });
    this.activity = Date.now();
    return this.presence();
  }

  /** Unregister a member; returns the presence frame to broadcast, or null if nothing to send. */
  leave(id: string): string | null {
    if (!this.members.delete(id)) { return null; }
    this.activity = Date.now();
    if (this.members.size === 0) { return null; }
    return this.presence();
  }

  /**
   * Route one cleartext frame: ui → all engines, engine → all uis. A heartbeat ping answers a
   * pong to the sender only (never forwarded cross-leg); pong-shaped, presence-shaped or
   * malformed input is dropped.
   */
  handleFrame(fromId: string, rawText: string): RoomOut[] {
    this.activity = Date.now();
    const member = this.members.get(fromId);
    if (!member) { return []; }
    const heartbeat = heartbeatKind(rawText);
    if (heartbeat === 'ping') { return [{ toId: fromId, text: PONG_FRAME }]; }
    if (heartbeat === 'pong' || isPresenceShaped(rawText) || !isForwardable(rawText)) { return []; }
    const role = member.role === 'ui' ? 'engine' : 'ui';
    return this.targets(role, member.role === 'engine' ? fromId : undefined)
      .map(toId => ({ toId, text: rawText }));
  }

  isIdle(nowMs: number): boolean {
    return nowMs - this.activity >= this.idleMs;
  }

  private targets(role: MemberRole, excludeId?: string): string[] {
    const ids: string[] = [];
    for (const [id, member] of this.members) {
      if (member.role === role && id !== excludeId) { ids.push(id); }
    }
    return ids;
  }

  private presence(): string {
    const members = [...this.members.values()].map(member => ({ role: member.role }));
    return JSON.stringify({ v: 1, t: 'presence', members });
  }
}
