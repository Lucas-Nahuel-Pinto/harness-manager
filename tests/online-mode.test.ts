import { describe, expect, test } from 'bun:test';
import { detectMode, isLocalOrigin, relayOverride } from '../src/online/mode.ts';
import { extractCodeFromInput } from '../src/online/pairing.ts';

const CODE = 'ABCDEFGHJKMNPQRSTVWXYZ2345';

describe('isLocalOrigin', () => {
  test('loopback and disk origins are local', () => {
    expect(isLocalOrigin('http://localhost:5173')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1:4173')).toBe(true);
    expect(isLocalOrigin('http://[::1]:3000')).toBe(true);
    expect(isLocalOrigin('file://')).toBe(true);
    expect(isLocalOrigin('file:///C:/harness/dist/index.html')).toBe(true);
    expect(isLocalOrigin('null')).toBe(true); // Firefox reports origin 'null' for file://
    expect(isLocalOrigin('')).toBe(true);
  });

  test('hosted and unparseable origins are NOT local', () => {
    expect(isLocalOrigin('https://demo.pages.dev')).toBe(false);
    expect(isLocalOrigin('https://localhost.attacker.com')).toBe(false); // substring trick rejected
    expect(isLocalOrigin('https://mylocalhost.example')).toBe(false);
    expect(isLocalOrigin('garbage-origin')).toBe(false);
  });
});

describe('detectMode', () => {
  test('local origins stay local even with a valid #c= (embedded build never dials a relay)', () => {
    expect(detectMode('http://localhost:5173', `#c=${CODE}`)).toBe('local');
    expect(detectMode('http://127.0.0.1:7397', `#c=${CODE}`)).toBe('local');
    expect(detectMode('file://', `#c=${CODE}`)).toBe('local');
    expect(detectMode('http://127.0.0.1:7397', '')).toBe('local');
  });

  test('hosted origin + valid code → online', () => {
    expect(detectMode('https://demo.pages.dev', `#c=${CODE}`)).toBe('online');
    expect(detectMode('https://demo.pages.dev', `c=${CODE}`)).toBe('online');
  });

  test('hosted origin without or with an invalid code → online-unpaired', () => {
    expect(detectMode('https://demo.pages.dev', '')).toBe('online-unpaired');
    expect(detectMode('https://demo.pages.dev', '#')).toBe('online-unpaired');
    expect(detectMode('https://demo.pages.dev', `#c=${CODE.slice(0, 25)}`)).toBe('online-unpaired');
    expect(detectMode('https://demo.pages.dev', `#c=${CODE}A`)).toBe('online-unpaired');
    expect(detectMode('https://demo.pages.dev', '#x=other')).toBe('online-unpaired');
  });

  test('?mode= overrides the origin rules (testing hook); invalid values are ignored', () => {
    expect(detectMode('http://127.0.0.1:4173', `#c=${CODE}`, '?mode=online')).toBe('online');
    expect(detectMode('http://127.0.0.1:4173', '', '?mode=online')).toBe('online-unpaired');
    expect(detectMode('https://demo.pages.dev', `#c=${CODE}`, '?mode=local')).toBe('local');
    expect(detectMode('http://127.0.0.1:4173', `#c=${CODE}`, '?mode=bogus')).toBe('local');
    expect(detectMode('https://demo.pages.dev', `#c=${CODE}`, '?relay=ws://x')).toBe('online');
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
    expect(relayOverride('?mode=online')).toBeNull();
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
