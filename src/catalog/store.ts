import { join } from 'node:path';

/**
 * SHARED CATALOG STORE — one engine-owned file for every harness (option B, 2026-10-13).
 *
 * Default sits in the repo's data/ dir next to recents.json (cwd-independent via
 * import.meta.dir). MODELS_CATALOG_PATH relocates it — tests inject temp stores so
 * the suite never touches the real cache or the network. Harness roots are never
 * written to: the per-harness `.models.catalog.json` concept is gone.
 */
export function catalogStorePath(): string {
  return process.env.MODELS_CATALOG_PATH
    ?? join(import.meta.dir, '..', '..', 'data', 'models.catalog.json');
}
