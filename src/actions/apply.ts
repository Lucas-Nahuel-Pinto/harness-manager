import type { HarnessSnapshot } from '../types.ts';
import { randomBytes } from 'node:crypto';
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { scanHarness } from '../scan/index.ts';

export interface ApplyResult {
  ok: boolean
  snapshot: HarnessSnapshot | null
  error: string | null
  detail: string | null
}

/** Write temp file in the SAME directory then rename over the target (never a partial write). */
export function atomicWrite(absPath: string, content: string): void {
  const tmp = join(dirname(absPath), `.harness-manager-${basename(absPath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(tmp, content, 'utf8');
  try {
    renameSync(tmp, absPath);
  }
  catch (error) {
    try { unlinkSync(tmp); }
    catch { /* temp already gone or never visible */ }
    throw error;
  }
}

/** Atomic write + full re-scan. The dispatcher guards the path BEFORE calling this. */
export function applyAndRescan(rootAbs: string, absPath: string, content: string): ApplyResult {
  try {
    atomicWrite(absPath, content);
  }
  catch (error) {
    return { ok: false, snapshot: null, error: 'write_failed', detail: error instanceof Error ? error.message : String(error) };
  }
  const { snapshot, error } = scanHarness(rootAbs);
  if (!snapshot) {
    return { ok: false, snapshot: null, error: 'rescan_failed', detail: `${error ?? 'scan failed'} — el archivo ya fue escrito` };
  }
  return { ok: true, snapshot, error: null, detail: null };
}
