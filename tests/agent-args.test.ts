import { describe, expect, test } from 'bun:test';
import { parseAgentArgv } from '../src/agent/args.ts';
import { RELAY_URL } from '../src/online/pairing.ts';

const CODE = 'ABCDEFGHJKMNPQRSTVWXYZ2345';
const PAIRING_URL = `https://harness-manager.harness-manager.workers.dev/#c=${CODE}`;

describe('parseAgentArgv', () => {
  test('no args → agent-generated flow (null code, production relay)', () => {
    expect(parseAgentArgv([])).toEqual({ code: null, relayUrl: RELAY_URL, invalidCode: false });
  });

  test('positional code → site-generated flow', () => {
    expect(parseAgentArgv([CODE])).toEqual({ code: CODE, relayUrl: RELAY_URL, invalidCode: false });
  });

  test('full pairing URL as positional (copy-paste friendly)', () => {
    expect(parseAgentArgv([PAIRING_URL]).code).toBe(CODE);
  });

  test('garbage positional → invalidCode, no code', () => {
    const args = parseAgentArgv(['not-a-code']);
    expect(args.invalidCode).toBe(true);
    expect(args.code).toBeNull();
  });

  test('--relay override after the positional code', () => {
    expect(parseAgentArgv([CODE, '--relay', 'ws://127.0.0.1:8788']))
      .toEqual({ code: CODE, relayUrl: 'ws://127.0.0.1:8788', invalidCode: false });
  });

  test('--relay override before the positional code', () => {
    expect(parseAgentArgv(['--relay', 'ws://127.0.0.1:8788', CODE]).code).toBe(CODE);
  });

  test('--relay without a ws value → production relay default', () => {
    expect(parseAgentArgv([CODE, '--relay']).relayUrl).toBe(RELAY_URL);
  });
});
