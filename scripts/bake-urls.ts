/**
 * Bake deployed URLs into the committed constants in `src/online/pairing.ts` (spec §11).
 *  Usage: `bun scripts/bake-urls.ts <pagesUrl> <relayUrl>` — the pure `bakeUrls` transform is
 *  unit-tested in `tests/bake-urls.test.ts`; this wrapper only does file IO.
 */
import { join } from 'node:path';

const PAIRING_PATH = join(import.meta.dir, '..', 'src', 'online', 'pairing.ts');

const PAGES_CONST = /(export const PAGES_URL = ')[^']*(')/;
const RELAY_CONST = /(export const RELAY_URL = ')[^']*(')/;

/** Rewrite ONLY the PAGES_URL/RELAY_URL string literals; idempotent; invalid URL → throws. */
export function bakeUrls(source: string, pagesUrl: string, relayUrl: string): string {
  if (!pagesUrl.startsWith('https://') || pagesUrl.endsWith('/') || /[\s'"]/.test(pagesUrl)) {
    throw new Error(`pagesUrl must be an https:// origin without trailing slash: ${pagesUrl}`);
  }
  if (!relayUrl.startsWith('wss://') || relayUrl.endsWith('/') || /[\s'"]/.test(relayUrl)) {
    throw new Error(`relayUrl must be a wss:// endpoint without trailing slash: ${relayUrl}`);
  }
  if (!PAGES_CONST.test(source)) { throw new Error('PAGES_URL literal not found'); }
  if (!RELAY_CONST.test(source)) { throw new Error('RELAY_URL literal not found'); }
  return source
    .replace(PAGES_CONST, (_match, before, after) => `${before}${pagesUrl}${after}`)
    .replace(RELAY_CONST, (_match, before, after) => `${before}${relayUrl}${after}`);
}

if (import.meta.main) {
  const [pagesUrl, relayUrl] = process.argv.slice(2);
  if (!pagesUrl || !relayUrl) {
    console.error('usage: bun scripts/bake-urls.ts <pagesUrl> <relayUrl>');
    process.exit(1);
  }
  const source = await Bun.file(PAIRING_PATH).text();
  const next = bakeUrls(source, pagesUrl, relayUrl);
  if (next === source) {
    console.log('URLs already baked — no change.');
  }
  else {
    await Bun.write(PAIRING_PATH, next);
    console.log(`baked PAGES_URL=${pagesUrl} RELAY_URL=${relayUrl}`);
  }
}
