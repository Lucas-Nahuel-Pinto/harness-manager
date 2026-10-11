/**
 * ONLINE LINE FILTER — buffered `Online: …` extraction over engine stdout chunks.
 *
 * Moved from `src/launcher/app.ts` for the desktop controller (spec §3.5). The
 * engine drains/reconnects the relay and re-prints the pairing line; consumers
 * decide which occurrence matters (the controller keeps only the FIRST).
 */

/** Prefix the engine prints before the hosted pairing URL. */
export const ONLINE_PREFIX = 'Online:';

/**
 * Returns the complete `Online: …` lines found in the chunk (partial lines carry
 * over to the next call). Without this the pairing URL would never reach the
 * consumer when the pipe is drained silently.
 */
export function createOnlineLineFilter(): (chunk: string) => string[] {
  let carry = '';
  return (chunk: string) => {
    carry += chunk;
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() ?? '';
    return lines.filter(line => line.startsWith(ONLINE_PREFIX));
  };
}

/** Extract the pairing URL from a complete `Online: <url>` line; anything else → null. */
export function onlineUrlFromLine(line: string): string | null {
  if (!line.startsWith(ONLINE_PREFIX)) { return null; }
  const url = line.slice(ONLINE_PREFIX.length).trim();
  return url === '' ? null : url;
}
