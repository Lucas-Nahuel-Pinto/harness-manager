import type { Transport } from '../src/online/transport.ts';
import { describe, expect, test } from 'bun:test';
import { commandText, formatLastUsed, waitForAgent } from '../src/online/launcher-screen.ts';

const CODE = 'ABCDEFGHJKMNPQRSTVWXYZ2345';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface Call {
  method: string
  path: string
  timeoutMs?: number
}

/** Fake Transport: scripted responses (value | throw) with call recording. */
function fakeTransport(script: Array<{ value?: unknown, throws?: Error }>): Transport & { calls: Call[] } {
  const calls: Call[] = [];
  let cursor = 0;
  return {
    calls,
    status: 'online',
    onStatus() {},
    close() {},
    async api<T>(method: 'GET' | 'POST', path: string, _body?: unknown, timeoutMs?: number): Promise<T> {
      calls.push({ method, path, timeoutMs });
      const step = script[Math.min(cursor, script.length - 1)];
      cursor += 1;
      if (step.throws) { throw step.throws; }
      return step.value as T;
    },
  };
}

describe('commandText', () => {
  test('one-liner with the bare code (no shell quoting needed)', () => {
    expect(commandText(CODE)).toBe(`bun agent.ts ${CODE}`);
  });
});

describe('formatLastUsed', () => {
  const now = 1_000_000_000_000;

  test('under a minute → recién', () => {
    expect(formatLastUsed(now - 30_000, now)).toBe('recién');
  });

  test('minutes / hours / days buckets', () => {
    expect(formatLastUsed(now - 5 * MINUTE, now)).toBe('hace 5 min');
    expect(formatLastUsed(now - 3 * HOUR, now)).toBe('hace 3 h');
    expect(formatLastUsed(now - 2 * DAY, now)).toBe('hace 2 d');
  });

  test('future timestamp clamps to recién', () => {
    expect(formatLastUsed(now + 5 * MINUTE, now)).toBe('recién');
  });
});

describe('waitForAgent', () => {
  test('agent already answering → first probe wins', async () => {
    const transport = fakeTransport([{ value: { state: 'running', root: '/x' } }]);
    expect(await waitForAgent(transport, { probeIntervalMs: 1 }))
      .toEqual({ state: 'running', root: '/x' });
    expect(transport.calls).toEqual([{ method: 'GET', path: '/api/agent/status', timeoutMs: 4000 }]);
  });

  test('agent joins later → retries with short probes until it answers', async () => {
    const transport = fakeTransport([
      { throws: new Error('timeout') },
      { throws: new Error('conexión perdida') },
      { value: { state: 'picker', root: null } },
    ]);
    expect(await waitForAgent(transport, { probeTimeoutMs: 5, probeIntervalMs: 1 }))
      .toEqual({ state: 'picker', root: null });
    expect(transport.calls).toHaveLength(3);
    expect(transport.calls.every(call => call.timeoutMs === 5)).toBe(true);
  });

  test('cancelled before the first probe → null, zero calls', async () => {
    const transport = fakeTransport([{ value: { state: 'picker', root: null } }]);
    expect(await waitForAgent(transport, { isCancelled: () => true })).toBeNull();
    expect(transport.calls).toHaveLength(0);
  });

  test('cancelled mid-wait → null (tab teardown / boot handoff)', async () => {
    const transport = fakeTransport([{ throws: new Error('timeout') }]);
    let probes = 0;
    expect(await waitForAgent(transport, {
      probeTimeoutMs: 5,
      probeIntervalMs: 1,
      isCancelled: () => { probes += 1; return probes > 1; },
    })).toBeNull();
    expect(transport.calls).toHaveLength(1);
  });

  test('maxAttempts exhausted → null (bounded resume-boot probe)', async () => {
    const transport = fakeTransport([{ throws: new Error('agente desconectado') }]);
    expect(await waitForAgent(transport, { probeTimeoutMs: 5, probeIntervalMs: 1, maxAttempts: 2 }))
      .toBeNull();
    expect(transport.calls).toHaveLength(2); // exactly maxAttempts probes, then give up
  });

  test('maxAttempts not exhausted by a late answer', async () => {
    const transport = fakeTransport([
      { throws: new Error('agente desconectado') },
      { value: { state: 'running', root: '/x' } },
    ]);
    expect(await waitForAgent(transport, { probeTimeoutMs: 5, probeIntervalMs: 1, maxAttempts: 3 }))
      .toEqual({ state: 'running', root: '/x' });
    expect(transport.calls).toHaveLength(2);
  });
});
