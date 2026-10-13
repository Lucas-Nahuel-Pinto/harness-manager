/**
 * MODEL CATALOG CACHE — read / atomic write / staleness.
 *
 * The store is engine-owned and SHARED across every harness: ONE file resolved by
 * catalog/store.ts (option B, 2026-10-13), never written inside a harness root.
 * On-disk shape stays `{ models, fetchedAt, sources }` (spec §3.1) so old caches
 * and the boilerplate's `scripts/model-catalog.ts` remain parseable.
 * Keys never appear here: the catalog stores model metadata only.
 */

import type { ModelEntry } from './parsers.ts';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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
