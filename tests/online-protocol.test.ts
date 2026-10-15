import { describe, expect, test } from 'bun:test';
import { decodePayload, encodePayload, HEARTBEAT_MS, isControlShaped, isPresence, makeReqId, PING_FRAME, REQUEST_TIMEOUT_MS, RUN_TIMEOUT_MS, timeoutForPath } from '../src/online/protocol.ts';

describe('makeReqId', () => {
  test('ids are unique', () => {
    const ids = new Set(Array.from({ length: 100 }, () => makeReqId()));
    expect(ids.size).toBe(100);
  });
});

describe('encodePayload / decodePayload', () => {
  test('req roundtrip', () => {
    const req = { id: 'a1', method: 'POST' as const, path: '/api/action', body: { kind: 'mcp-toggle' } };
    expect(decodePayload(encodePayload(req))).toEqual(req);
  });

  test('req without body roundtrip', () => {
    const req = { id: 'a2', method: 'GET' as const, path: '/api/snapshot' };
    expect(decodePayload(encodePayload(req))).toEqual(req);
  });

  test('res roundtrip', () => {
    const res = { id: 'a3', status: 200, body: { ok: true } };
    expect(decodePayload(encodePayload(res))).toEqual(res);
  });

  test('rejects missing / empty id', () => {
    expect(() => decodePayload(JSON.stringify({ method: 'GET', path: '/api/snapshot' }))).toThrow();
    expect(() => decodePayload(JSON.stringify({ id: '', method: 'GET', path: '/api/snapshot' }))).toThrow();
  });

  test('rejects method outside the allowlist', () => {
    expect(() => decodePayload(JSON.stringify({ id: 'x', method: 'DELETE', path: '/api/snapshot' }))).toThrow();
    expect(() => decodePayload(JSON.stringify({ id: 'x', method: 'patch', path: '/api/snapshot' }))).toThrow();
  });

  test('rejects path outside /api/', () => {
    expect(() => decodePayload(JSON.stringify({ id: 'x', method: 'GET', path: '/snapshot' }))).toThrow();
    expect(() => decodePayload(JSON.stringify({ id: 'x', method: 'GET', path: 'api/snapshot' }))).toThrow();
    expect(() => decodePayload(JSON.stringify({ id: 'x', method: 'GET', path: '/' }))).toThrow();
  });

  test('rejects non-req/res payloads', () => {
    expect(() => decodePayload('"just a string"')).toThrow();
    expect(() => decodePayload('null')).toThrow();
    expect(() => decodePayload('[1,2]')).toThrow();
    expect(() => decodePayload('{"id":"x"}')).toThrow();
    expect(() => decodePayload('not json {')).toThrow();
  });

  test('rejects res with non-numeric status', () => {
    expect(() => decodePayload(JSON.stringify({ id: 'x', status: '200', body: null }))).toThrow();
  });
});

describe('isPresence', () => {
  test('detects the cleartext presence frame', () => {
    expect(isPresence(JSON.stringify({ v: 1, t: 'presence', members: [{ role: 'engine' }] }))).toBe(true);
    expect(isPresence(JSON.stringify({ v: 1, t: 'presence', members: [] }))).toBe(true);
  });

  test('rejects everything else', () => {
    expect(isPresence(JSON.stringify({ id: 'x', method: 'GET', path: '/api/snapshot' }))).toBe(false);
    expect(isPresence(JSON.stringify({ v: 1, t: 'req' }))).toBe(false);
    expect(isPresence('not json')).toBe(false);
    expect(isPresence('"string"')).toBe(false);
    expect(isPresence('null')).toBe(false);
  });
});

describe('heartbeat control frames (design 2026-10-15)', () => {
  test('cadence constant + exact ping frame shape', () => {
    expect(HEARTBEAT_MS).toBe(25_000);
    expect(PING_FRAME).toBe('{"v":1,"t":"ping"}');
  });

  test('isControlShaped detects every cleartext control frame', () => {
    expect(isControlShaped(PING_FRAME)).toBe(true);
    expect(isControlShaped(JSON.stringify({ v: 1, t: 'pong' }))).toBe(true);
    expect(isControlShaped(JSON.stringify({ v: 1, t: 'join', room: 'abc', role: 'ui' }))).toBe(true);
    expect(isControlShaped(JSON.stringify({ v: 1, t: 'presence', members: [] }))).toBe(true);
  });

  test('isControlShaped never matches payloads, envelopes or non-objects', () => {
    expect(isControlShaped(JSON.stringify({ id: 'a1', method: 'GET', path: '/api/snapshot' }))).toBe(false);
    expect(isControlShaped(JSON.stringify({ id: 'a3', status: 200, body: null }))).toBe(false);
    expect(isControlShaped(JSON.stringify({ v: 1, n: 'nonce', c: 'cipher' }))).toBe(false); // crypto envelope
    expect(isControlShaped('"string"')).toBe(false);
    expect(isControlShaped('null')).toBe(false);
    expect(isControlShaped('[1,2]')).toBe(false);
    expect(isControlShaped('not json')).toBe(false);
  });
});

describe('timeouts', () => {
  test('constants', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(RUN_TIMEOUT_MS).toBe(45_000);
  });

  test('timeoutForPath classifies run vs regular requests', () => {
    expect(timeoutForPath('/api/run')).toBe(45_000);
    expect(timeoutForPath('/api/run?stage=2')).toBe(45_000);
    expect(timeoutForPath('/api/snapshot')).toBe(30_000);
    expect(timeoutForPath('/api/action')).toBe(30_000);
  });
});
