import { realpathSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

/**
 * Resolve `relPath` strictly inside `rootAbs`, or null when it escapes.
 *
 * Rejection rules (tested one by one):
 * - `..` segments (checked before AND after resolve — belt and braces)
 * - absolute paths: POSIX `/x`, drive letters `C:\x` / `C:/x`, drive-relative `C:x`, UNC `\\srv\share`
 * - NUL bytes
 * - URL-encoded traversal: decoded ONCE (`%2e%2e%2f` → `../` → rejected). A double-encoded
 *   payload decodes to the literal `%2e%2e%2f` which stays a plain filename INSIDE root, so a
 *   single decode is enough to close the hole without over-rejecting.
 * - target resolving outside `root + sep` after `path.resolve`
 * - symlinks: when both root and target exist we compare REAL paths (best-effort; a broken
 *   `realpathSync` falls back to the normalized path already prefix-checked above).
 */
export function resolveInRoot(rootAbs: string, relPath: string): string | null {
  if (typeof relPath !== 'string' || relPath.length === 0) { return null; }
  if (relPath.includes('\0')) { return null; }

  let candidate = relPath;
  try {
    const decoded = decodeURIComponent(relPath);
    candidate = decoded;
  }
  catch {
    // Malformed percent-encoding is a literal filename, not a traversal — keep raw text.
  }

  if (candidate.length === 0) { return null; }
  if (isAbsolute(candidate) || /^[a-z]:/i.test(candidate) || /^[/\\]/.test(candidate)) { return null; }
  if (candidate.split(/[/\\]/).includes('..')) { return null; }

  const root = resolve(rootAbs);
  const abs = resolve(root, candidate);
  if (!insideRoot(root, abs)) { return null; }

  try {
    const realRoot = realpathSync(root);
    const realTarget = realpathSync(abs);
    if (!insideRoot(realRoot, realTarget)) { return null; }
  }
  catch {
    // Target or root not realpath-able (missing file / no perm) — normalized prefix check stands.
  }

  return abs;
}

function insideRoot(root: string, target: string): boolean {
  if (target === root) { return false; } // root itself is never a valid target
  return target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}
