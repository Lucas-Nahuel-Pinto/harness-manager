/** Online message protocol: payload types + codec (frames are encrypted by `crypto.ts`; presence stays cleartext). */

export interface ReqFrame {
  id: string
  method: 'GET' | 'POST'
  path: string
  body?: unknown
}

export interface ResFrame {
  id: string
  status: number
  body: unknown
}

export interface PresenceFrame {
  v: 1
  t: 'presence'
  members: Array<{ role: 'engine' | 'ui' }>
}

export const REQUEST_TIMEOUT_MS = 30_000;
export const RUN_TIMEOUT_MS = 45_000;

/** UI timeouts: `script-run` requests get the longer budget. */
export function timeoutForPath(path: string): number {
  return path.includes('/api/run') ? RUN_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

/** Presence frames are the only cleartext payload — detected before any decryption attempt. */
export function isPresence(text: string): boolean {
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

export function encodePayload(payload: ReqFrame | ResFrame): string {
  return JSON.stringify(payload);
}

/** Parse + validate a decrypted payload; anything that is not a well-formed req/res → throws. */
export function decodePayload(text: string): ReqFrame | ResFrame {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) { throw new Error('payload must be an object'); }
  const frame = parsed as Record<string, unknown>;
  if (typeof frame.id !== 'string' || frame.id.length === 0) { throw new Error('payload.id must be a non-empty string'); }
  if ('method' in frame) {
    if (frame.method !== 'GET' && frame.method !== 'POST') { throw new Error('payload.method must be GET or POST'); }
    if (typeof frame.path !== 'string' || !frame.path.startsWith('/api/')) { throw new Error('payload.path must start with /api/'); }
    return { id: frame.id, method: frame.method, path: frame.path, body: frame.body };
  }
  if (typeof frame.status === 'number') {
    return { id: frame.id, status: frame.status, body: frame.body };
  }
  throw new Error('payload must be a req (method) or res (status) frame');
}

export function makeReqId(): string {
  return crypto.randomUUID();
}
