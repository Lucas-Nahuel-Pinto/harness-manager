/**
 * RECENTS — pure MRU list + atomic JSON persistence for `data/recents.json` (spec §3.5).
 *
 * Order is MRU (front = most recent use) and every entry carries `lastUsed`;
 * `loadRecents` degrades missing/corrupt/wrong-shape files to `[]` and
 * `saveRecents` writes atomically (`.tmp` in the same dir + rename) so the
 * picker never reads a torn file.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RecentEntry {
  path: string
  lastUsed: number
}

/** Spec §3.5: the MRU list is capped at 10 roots. */
export const RECENTS_CAP = 10;

export interface AddRecentOptions {
  /** Defaults to `RECENTS_CAP`. */
  cap?: number
  /** Clock seam — tests inject a fixed time. */
  now?: () => number
  /** Dedupe key: case/separator-insensitive on win32, exact elsewhere. Defaults to `process.platform`. */
  platform?: NodeJS.Platform
}

function dedupeKey(path: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') { return path.replace(/\//g, '\\').toLowerCase(); }
  return path;
}

function isRecentEntry(value: unknown): value is RecentEntry {
  if (typeof value !== 'object' || value === null) { return false; }
  const entry = value as Partial<RecentEntry>;
  return typeof entry.path === 'string' && Number.isFinite(entry.lastUsed);
}

/** Pure MRU: dedupe by platform-aware key, move `root` to the front with a fresh `lastUsed`, cap. Never mutates `list`. */
export function addRecent(list: RecentEntry[], root: string, opts: AddRecentOptions = {}): RecentEntry[] {
  const cap = opts.cap ?? RECENTS_CAP;
  const now = opts.now ?? Date.now;
  const platform = opts.platform ?? process.platform;
  const key = dedupeKey(root, platform);
  const rest = list.filter(entry => dedupeKey(entry.path, platform) !== key);
  return [{ path: root, lastUsed: now() }, ...rest].slice(0, Math.max(cap, 0));
}

/** Read the recents file. Missing, corrupt, or wrong shape → []; malformed entries are dropped. */
export function loadRecents(filePath: string): RecentEntry[] {
  if (!existsSync(filePath)) { return []; }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed)) { return []; }
    return parsed.filter(isRecentEntry);
  }
  catch { return []; }
}

/** Atomic write: `.tmp` in the same directory + rename — readers never see a torn file. */
export function saveRecents(filePath: string, entries: RecentEntry[]): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); }
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  renameSync(tmpPath, filePath);
}
