import { describe, expect, test } from 'bun:test';
import { decryptFrame, deriveKey, encryptFrame } from '../src/online/crypto.ts';

const CODE_A = 'ABCDEFGHJKMNPQRSTVWXYZ2345';
const CODE_B = 'ZYXWVUTSRQPONMLKJHGFEDCBA2';
const PAYLOAD = { id: 'req-1', method: 'GET', path: '/api/snapshot', body: { nested: { ok: true }, n: 42 } };

async function rejects(promise: Promise<unknown>): Promise<boolean> {
  try {
    await promise;
    return false;
  }
  catch {
    return true;
  }
}

describe('deriveKey', () => {
  test('same code → identical room (64 hex) and interoperable keys', async () => {
    const first = await deriveKey(CODE_A);
    const second = await deriveKey(CODE_A);
    expect(first.room).toBe(second.room);
    expect(first.room).toMatch(/^[0-9a-f]{64}$/);

    const envelope = await encryptFrame(first.key, first.room, PAYLOAD);
    expect(await decryptFrame(second.key, second.room, envelope)).toEqual(PAYLOAD);
  });

  test('different code → different room and non-interoperable key', async () => {
    const a = await deriveKey(CODE_A);
    const b = await deriveKey(CODE_B);
    expect(a.room).not.toBe(b.room);

    const envelope = await encryptFrame(a.key, a.room, PAYLOAD);
    expect(await rejects(decryptFrame(b.key, b.room, envelope))).toBe(true);
  });
});

describe('encryptFrame / decryptFrame', () => {
  test('roundtrip returns the original payload', async () => {
    const { room, key } = await deriveKey(CODE_A);
    const envelope = await encryptFrame(key, room, PAYLOAD);
    expect(await decryptFrame(key, room, envelope)).toEqual(PAYLOAD);
  });

  test('envelope shape is {v:1, n, c}', async () => {
    const { room, key } = await deriveKey(CODE_A);
    const envelope = JSON.parse(await encryptFrame(key, room, PAYLOAD)) as Record<string, unknown>;
    expect(envelope.v).toBe(1);
    expect(typeof envelope.n).toBe('string');
    expect(typeof envelope.c).toBe('string');
    expect((envelope.n as string).length).toBeGreaterThan(0);
    expect((envelope.c as string).length).toBeGreaterThan(0);
  });

  test('decrypt with key from the WRONG code rejects (GCM auth failure)', async () => {
    const right = await deriveKey(CODE_A);
    const wrong = await deriveKey(CODE_B);
    const envelope = await encryptFrame(right.key, right.room, PAYLOAD);
    expect(await rejects(decryptFrame(wrong.key, wrong.room, envelope))).toBe(true);
  });

  test('tampered ciphertext (flipped base64 char) rejects', async () => {
    const { room, key } = await deriveKey(CODE_A);
    const envelope = JSON.parse(await encryptFrame(key, room, PAYLOAD)) as { v: number, n: string, c: string };
    const flipped = (envelope.c[0] === 'A' ? 'B' : 'A') + envelope.c.slice(1);
    expect(await rejects(decryptFrame(key, room, JSON.stringify({ v: envelope.v, n: envelope.n, c: flipped })))).toBe(true);
  });

  test('AAD binds the frame to its room: decrypt under another room id rejects', async () => {
    const right = await deriveKey(CODE_A);
    const other = await deriveKey(CODE_B);
    const envelope = await encryptFrame(right.key, right.room, PAYLOAD);
    expect(await rejects(decryptFrame(right.key, other.room, envelope))).toBe(true);
  });

  test('malformed envelope shape rejects', async () => {
    const { room, key } = await deriveKey(CODE_A);
    expect(await rejects(decryptFrame(key, room, JSON.stringify({ v: 2, n: 'aa', c: 'bb' })))).toBe(true);
    expect(await rejects(decryptFrame(key, room, '"not an object"'))).toBe(true);
    expect(await rejects(decryptFrame(key, room, 'not json at all {'))).toBe(true);
  });
});
