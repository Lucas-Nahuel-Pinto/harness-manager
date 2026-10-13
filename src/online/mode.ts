/** UI mode detection — pure helpers (no DOM) so tests can drive them with plain strings. */

import { parseCodeFromHash } from './pairing.ts';

export type UiMode = 'online' | 'online-unpaired';

/**
 * Decide the boot mode — ONE set of rules for every origin (hosted or loopback, spec
 * 2026-10-12): a valid `#c=` fragment is the only door in. The local fetch path is gone,
 * so the origin is not even an input.
 */
export function detectMode(hash: string): UiMode {
  return parseCodeFromHash(hash) === null ? 'online-unpaired' : 'online';
}

/** `?relay=ws(s)://…` — local-testing override for the committed `RELAY_URL` constant. */
export function relayOverride(search: string): string | null {
  const relay = new URLSearchParams(search).get('relay');
  return relay !== null && /^wss?:\/\/\S+$/.test(relay) ? relay : null;
}
