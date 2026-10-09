import { describe, expect, test } from 'bun:test';
import { bytesToCode, codeToBytes, generateCode, PAGES_URL, pairingUrl, parseCodeFromHash, RELAY_URL } from '../src/online/pairing.ts';

const encoder = new TextEncoder();
const CODE = 'ABCDEFGHJKMNPQRSTVWXYZ2345';

describe('base32 (RFC 4648, no padding)', () => {
  const vectors: Array<[input: string, encoded: string]> = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ];

  test.each(vectors)('encode/decode %j ↔ %j', (input, encoded) => {
    expect(bytesToCode(encoder.encode(input))).toBe(encoded);
    expect(codeToBytes(encoded)).toEqual(encoder.encode(input));
  });

  test('roundtrip random 16 bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    expect(codeToBytes(bytesToCode(bytes))).toEqual(bytes);
  });

  test('invalid character throws', () => {
    expect(() => codeToBytes('0')).toThrow();
    expect(() => codeToBytes('ABC1')).toThrow();
  });
});

describe('generateCode', () => {
  test('26 chars of the RFC 4648 alphabet', () => {
    const code = generateCode();
    expect(code).toHaveLength(26);
    expect(code).toMatch(/^[A-Z2-7]{26}$/);
  });

  test('decodes back to 16 bytes', () => {
    expect(codeToBytes(generateCode())).toHaveLength(16);
  });

  test('codes differ across calls', () => {
    expect(generateCode()).not.toBe(generateCode());
  });
});

describe('parseCodeFromHash', () => {
  test('accepts #c= and bare c= forms', () => {
    expect(parseCodeFromHash(`#c=${CODE}`)).toBe(CODE);
    expect(parseCodeFromHash(`c=${CODE}`)).toBe(CODE);
  });

  test('rejects bad prefix', () => {
    expect(parseCodeFromHash(`#x=${CODE}`)).toBeNull();
    expect(parseCodeFromHash(`#${CODE}`)).toBeNull();
    expect(parseCodeFromHash('')).toBeNull();
    expect(parseCodeFromHash('#')).toBeNull();
  });

  test('rejects bad length', () => {
    expect(parseCodeFromHash(`#c=${CODE.slice(0, 25)}`)).toBeNull();
    expect(parseCodeFromHash(`#c=${CODE}A`)).toBeNull();
    expect(parseCodeFromHash('#c=')).toBeNull();
  });

  test('rejects bad charset (RFC 4648 excludes 0, 1, 8, 9 and lowercase)', () => {
    expect(parseCodeFromHash(`#c=0${CODE.slice(1)}`)).toBeNull();
    expect(parseCodeFromHash(`#c=1${CODE.slice(1)}`)).toBeNull();
    expect(parseCodeFromHash(`#c=${CODE.slice(0, 25)}8`)).toBeNull();
    expect(parseCodeFromHash(`#c=${CODE.slice(0, 25)}a`)).toBeNull();
    expect(parseCodeFromHash(`#c=${CODE.slice(0, 25)}-`)).toBeNull();
  });
});

describe('pairingUrl + constants', () => {
  test('format', () => {
    expect(pairingUrl('https://demo.pages.dev', 'XYZ')).toBe('https://demo.pages.dev/#c=XYZ');
  });

  test('committed endpoint constants are absolute', () => {
    expect(PAGES_URL.startsWith('https://')).toBe(true);
    expect(RELAY_URL.startsWith('wss://')).toBe(true);
  });
});
