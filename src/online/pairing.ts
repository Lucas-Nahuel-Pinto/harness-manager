/** Session-code pairing for online mode — RFC 4648 base32 (no padding) over 16 random bytes → 26 chars. */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Deployed Pages origin (spec §11: committed constant, no secrecy). PLACEHOLDER until Phase 4 deploy. */
export const PAGES_URL = 'https://PLACEHOLDER.pages.dev';

/** Deployed relay Worker WS endpoint. PLACEHOLDER until Phase 4 deploy. */
export const RELAY_URL = 'wss://PLACEHOLDER.workers.dev/relay';

/** Encode bytes as unpadded RFC 4648 base32. */
export function bytesToCode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let code = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      code += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) { code += BASE32_ALPHABET[(value << (5 - bits)) & 31]; }
  return code;
}

/** Decode an unpadded RFC 4648 base32 code back to bytes; invalid character → throws. */
export function codeToBytes(code: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of code) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) { throw new Error(`invalid base32 character: ${char}`); }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/** 16 CSPRNG bytes → 26-char session code. */
export function generateCode(): string {
  return bytesToCode(crypto.getRandomValues(new Uint8Array(16)));
}

/** Build the pairing URL: the code lives in the fragment, which browsers never transmit. */
export function pairingUrl(pagesUrl: string, code: string): string {
  return `${pagesUrl}/#c=${code}`;
}

/** Extract a valid 26-char code from `#c=XXXX` (or bare `c=XXXX`); anything else → null. */
export function parseCodeFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith('c=')) { return null; }
  const code = raw.slice(2);
  if (!/^[A-Z2-7]{26}$/.test(code)) { return null; }
  return code;
}

/**
 * Pairing-screen input: a full pairing URL (code in the fragment), a `#c=`/`c=` form, or the bare
 * 26-char code; anything else → null. Case is NOT normalized — the engine prints exact uppercase.
 */
export function extractCodeFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') { return null; }
  const hashIndex = trimmed.indexOf('#');
  if (hashIndex !== -1) { return parseCodeFromHash(trimmed.slice(hashIndex)); }
  if (trimmed.startsWith('c=')) { return parseCodeFromHash(trimmed); }
  return /^[A-Z2-7]{26}$/.test(trimmed) ? trimmed : null;
}
