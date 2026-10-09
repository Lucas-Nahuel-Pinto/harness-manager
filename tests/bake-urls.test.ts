import { describe, expect, test } from 'bun:test';
import { bakeUrls } from '../scripts/bake-urls.ts';

const SOURCE = `/** doc comment */
export const PAGES_URL = 'https://PLACEHOLDER.pages.dev';
export const RELAY_URL = 'wss://PLACEHOLDER.workers.dev/relay';
const UNRELATED = 'https://keep.me/untouched';
`;

const PAGES = 'https://demo.pages.dev';
const RELAY = 'wss://relay.example.workers.dev/relay';

describe('bakeUrls (pure transform)', () => {
  test('rewrites only the two committed literals', () => {
    const out = bakeUrls(SOURCE, PAGES, RELAY);
    expect(out).toContain(`export const PAGES_URL = '${PAGES}';`);
    expect(out).toContain(`export const RELAY_URL = '${RELAY}';`);
    expect(out).toContain('const UNRELATED = \'https://keep.me/untouched\';');
    expect(out).not.toContain('PLACEHOLDER');
  });

  test('byte-identical apart from the two literals', () => {
    const expected = SOURCE
      .replace('https://PLACEHOLDER.pages.dev', PAGES)
      .replace('wss://PLACEHOLDER.workers.dev/relay', RELAY);
    expect(bakeUrls(SOURCE, PAGES, RELAY)).toBe(expected);
  });

  test('idempotent — baking the same URLs is a no-op', () => {
    const once = bakeUrls(SOURCE, PAGES, RELAY);
    expect(bakeUrls(once, PAGES, RELAY)).toBe(once);
  });

  test('works on already-baked non-placeholder values', () => {
    const baked = bakeUrls(SOURCE, PAGES, RELAY);
    const rebaked = bakeUrls(baked, 'https://new.pages.dev', 'wss://new.workers.dev/relay');
    expect(rebaked).toContain('export const PAGES_URL = \'https://new.pages.dev\';');
    expect(rebaked).toContain('export const RELAY_URL = \'wss://new.workers.dev/relay\';');
  });

  test('rejects non-https pages URL', () => {
    expect(() => bakeUrls(SOURCE, 'http://demo.pages.dev', RELAY)).toThrow(/pagesUrl/);
  });

  test('rejects trailing slash on pages URL', () => {
    expect(() => bakeUrls(SOURCE, 'https://demo.pages.dev/', RELAY)).toThrow(/pagesUrl/);
  });

  test('rejects non-wss relay URL', () => {
    expect(() => bakeUrls(SOURCE, PAGES, 'ws://relay.example/relay')).toThrow(/relayUrl/);
  });

  test('rejects trailing slash on relay URL', () => {
    expect(() => bakeUrls(SOURCE, PAGES, 'wss://relay.example/relay/')).toThrow(/relayUrl/);
  });

  test('throws when a constant is missing', () => {
    expect(() => bakeUrls('export const RELAY_URL = \'wss://a/relay\';', PAGES, RELAY)).toThrow(/PAGES_URL/);
    expect(() => bakeUrls('export const PAGES_URL = \'https://a\';', PAGES, RELAY)).toThrow(/RELAY_URL/);
  });
});
