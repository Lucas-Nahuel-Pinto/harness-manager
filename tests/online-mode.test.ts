import { describe, expect, test } from 'bun:test';
import { detectMode, relayOverride } from '../src/online/mode.ts';
import { extractCodeFromInput } from '../src/online/pairing.ts';

const CODE = 'ABCDEFGHJKMNPQRSTVWXYZ2345';

describe('detectMode', () => {
  // Origin left the signature (spec 2026-10-12): ONE boot path for every origin — hosted,
  // loopback and file:// follow these same rules; there is no local branch to test anymore.
  test('a valid #c= fragment → online', () => {
    expect(detectMode(`#c=${CODE}`)).toBe('online');
    expect(detectMode(`c=${CODE}`)).toBe('online');
  });

  test('absent or invalid fragment → online-unpaired', () => {
    expect(detectMode('')).toBe('online-unpaired');
    expect(detectMode('#')).toBe('online-unpaired');
    expect(detectMode(`#c=${CODE.slice(0, 25)}`)).toBe('online-unpaired');
    expect(detectMode(`#c=${CODE}A`)).toBe('online-unpaired');
    expect(detectMode('#x=other')).toBe('online-unpaired');
  });
});

describe('relayOverride', () => {
  test('accepts ws:// and wss:// URLs', () => {
    expect(relayOverride('?relay=ws://127.0.0.1:8788')).toBe('ws://127.0.0.1:8788');
    expect(relayOverride('?relay=wss://r.workers.dev/relay')).toBe('wss://r.workers.dev/relay');
    expect(relayOverride('?a=1&relay=ws://h:1')).toBe('ws://h:1');
    expect(relayOverride('relay=ws://h:1')).toBe('ws://h:1');
  });

  test('rejects missing, empty and non-ws values', () => {
    expect(relayOverride('')).toBeNull();
    expect(relayOverride('?x=1')).toBeNull();
    expect(relayOverride('?relay=')).toBeNull();
    expect(relayOverride('?relay=http://x')).toBeNull();
    expect(relayOverride('?relay=javascript:alert(1)')).toBeNull();
  });
});

describe('extractCodeFromInput (pairing screen)', () => {
  test('accepts a full pairing URL, the fragment form and the bare code', () => {
    expect(extractCodeFromInput(`https://demo.pages.dev/#c=${CODE}`)).toBe(CODE);
    expect(extractCodeFromInput(`  https://demo.pages.dev/#c=${CODE}  `)).toBe(CODE);
    expect(extractCodeFromInput(`#c=${CODE}`)).toBe(CODE);
    expect(extractCodeFromInput(`c=${CODE}`)).toBe(CODE);
    expect(extractCodeFromInput(CODE)).toBe(CODE);
  });

  test('accepts console hard-wrap artifacts: embedded newlines/spaces in URL or code', () => {
    // conhost hard-wraps the ~89-char pairing line at 80 cols — copies carry the wrap as whitespace
    expect(extractCodeFromInput(`https://demo.pages.dev/#c=${CODE.slice(0, 10)}\n${CODE.slice(10)}`)).toBe(CODE);
    expect(extractCodeFromInput(`Online: https://demo.pages.dev/#c=${CODE}`)).toBe(CODE);
    expect(extractCodeFromInput(`${CODE.slice(0, 8)} ${CODE.slice(8)}`)).toBe(CODE);
    expect(extractCodeFromInput(`${CODE.slice(0, 13)}\r\n${CODE.slice(13)}`)).toBe(CODE);
  });

  test('rejects wrong length', () => {
    expect(extractCodeFromInput(CODE.slice(0, 25))).toBeNull();
    expect(extractCodeFromInput(`${CODE}A`)).toBeNull();
    expect(extractCodeFromInput('')).toBeNull();
    expect(extractCodeFromInput('   ')).toBeNull();
  });

  test('rejects wrong charset (case is never normalized)', () => {
    expect(extractCodeFromInput(`0${CODE.slice(1)}`)).toBeNull();
    expect(extractCodeFromInput(`${CODE.slice(0, 25)}9`)).toBeNull();
    expect(extractCodeFromInput(CODE.toLowerCase())).toBeNull();
    expect(extractCodeFromInput(`${CODE.slice(0, 25)}-`)).toBeNull();
  });

  test('rejects URLs without a #c= fragment or with a foreign fragment', () => {
    expect(extractCodeFromInput('https://demo.pages.dev/')).toBeNull();
    expect(extractCodeFromInput(`https://demo.pages.dev/#other=${CODE}`)).toBeNull();
    expect(extractCodeFromInput('hola que tal')).toBeNull();
  });
});
