/** UI mode detection — pure helpers (no DOM) so tests can drive them with plain strings. */

import { parseCodeFromHash } from './pairing.ts';

export type UiMode = 'local' | 'online' | 'online-unpaired';

/**
 * Local = the origin the app has always run from: loopback (dev/serve/launcher) or `file://`
 * (embedded build). `origin === 'null'` is how Firefox reports `file://`. Everything else is a
 * hosted origin → online rules apply (a valid `#c=` fragment is the only door in).
 */
export function isLocalOrigin(origin: string): boolean {
  if (origin === '' || origin === 'null' || origin.startsWith('file:')) { return true; }
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  }
  catch {
    return false;
  }
}

/**
 * Decide the boot mode. Local origins stay on the historical fetch path even when a code is
 * present (an embedded/local build must never dial a relay). `?mode=local|online` is an explicit
 * override for testing the online UI from loopback; an invalid value falls through to the rules.
 */
export function detectMode(origin: string, hash: string, search = ''): UiMode {
  const override = new URLSearchParams(search).get('mode');
  if (override === 'local') { return 'local'; }
  if (override !== 'online' && isLocalOrigin(origin)) { return 'local'; }
  return parseCodeFromHash(hash) === null ? 'online-unpaired' : 'online';
}

/** `?relay=ws(s)://…` — local-testing override for the committed `RELAY_URL` constant. */
export function relayOverride(search: string): string | null {
  const relay = new URLSearchParams(search).get('relay');
  return relay !== null && /^wss?:\/\/\S+$/.test(relay) ? relay : null;
}
