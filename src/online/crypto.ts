/** E2E crypto for online mode — WebCrypto only, runs in Bun (tests) and the browser (bundled UI/engine). */

const ROOM_SALT = 'harness-manager-online-v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) { out += byte.toString(16).padStart(2, '0'); }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) { binary += String.fromCharCode(byte); }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
  return bytes;
}

/** Derive the room id (hex SHA-256 of the code) and the AES-GCM-256 room key (PBKDF2-SHA256, 100k iters). */
export async function deriveKey(code: string): Promise<{ room: string, key: CryptoKey }> {
  const codeBytes = encoder.encode(code);
  const room = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', codeBytes)));
  const baseKey = await crypto.subtle.importKey('raw', codeBytes, 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode(ROOM_SALT), iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { room, key };
}

/** Encrypt a payload into the cleartext envelope `{v:1, n, c}` (AES-GCM, fresh 12-byte nonce per frame). */
export async function encryptFrame(key: CryptoKey, room: string, payload: unknown): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  // AAD = room id: binds the ciphertext to its room, so a frame replayed into another room fails authentication.
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(room) },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return JSON.stringify({ v: 1, n: bytesToBase64(nonce), c: bytesToBase64(new Uint8Array(ciphertext)) });
}

/** Decrypt an envelope back to the payload; wrong key, tampered frame, or bad shape → throws (never swallowed). */
export async function decryptFrame(key: CryptoKey, room: string, envelopeText: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(envelopeText);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) { throw new Error('envelope must be an object'); }
  const envelope = parsed as { v?: unknown, n?: unknown, c?: unknown };
  if (envelope.v !== 1 || typeof envelope.n !== 'string' || typeof envelope.c !== 'string') { throw new Error('envelope must be {v:1, n, c}'); }
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(envelope.n), additionalData: encoder.encode(room) },
    key,
    base64ToBytes(envelope.c),
  );
  return JSON.parse(decoder.decode(plaintext));
}
