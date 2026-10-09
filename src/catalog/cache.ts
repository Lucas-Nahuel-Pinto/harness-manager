/**
 * MODEL CATALOG CACHE — read / atomic write / staleness / interest gate.
 *
 * The on-disk contract is byte-compatible with the boilerplate harness's
 * `scripts/model-catalog.ts` (`{ models, fetchedAt, sources }` at
 * `<root>/<catalogFile>` — spec §3.1), so both sides read the same file.
 * Keys never appear here: the catalog stores model metadata only.
 */

import type { ModelEntry } from './parsers.ts';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ModelCatalog {
  models: ModelEntry[]
  fetchedAt: number
  sources: string[]
}

/** Default catalog TTL: 24h. Callers honor MODELS_CACHE_TTL by passing ttlMs (keeps isStale pure). */
export const DEFAULT_TTL_MS = 86_400_000;

/** Read the catalog cache. Missing file, invalid JSON, or wrong shape → null (callers degrade). */
export function readCatalog(path: string): ModelCatalog | null {
  if (!existsSync(path)) { return null; }
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<ModelCatalog>;
    if (!Array.isArray(data.models) || typeof data.fetchedAt !== 'number' || !Array.isArray(data.sources)) {
      return null;
    }
    return { models: data.models, fetchedAt: data.fetchedAt, sources: data.sources };
  }
  catch {
    return null;
  }
}

/** True when the catalog is older than ttlMs (default 24h). Boundary: exactly ttlMs is still fresh. */
export function isStale(catalog: ModelCatalog, ttlMs: number = DEFAULT_TTL_MS, now: number = Date.now()): boolean {
  return now - catalog.fetchedAt > ttlMs;
}

/** Atomic write: temp file in the same directory + rename — readers never see a torn file. */
export function writeCatalogAtomic(path: string, catalog: ModelCatalog): void {
  const dir = dirname(path);
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); }
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  renameSync(tmpPath, path);
}

/**
 * Write-scope gate (spec §3.5): the harness wants a catalog when its manifest
 * declares `models`, the catalog file already exists (at the manifest-declared
 * name or `.models.catalog.json`), or package.json ships a `harness-config`
 * script. Arbitrary harnesses are never littered.
 */
export function declaresInterest(
  root: string,
  manifest: { models?: unknown } | null,
  catalogFile = '.models.catalog.json',
): boolean {
  if (manifest?.models) { return true; }
  if (existsSync(join(root, catalogFile))) { return true; }
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
      if (pkg.scripts?.['harness-config']) { return true; }
    }
    catch { }
  }
  return false;
}
