import type { HarnessSnapshot } from './types.ts';

/**
 * Empty shell — the online bundle embeds ZERO harness data (spec 2026-10-11 §3.6):
 * the store fills from `/api/snapshot` over the relay once a root is picked.
 */
const EMPTY_SNAPSHOT: HarnessSnapshot = {
  schemaVersion: 1,
  meta: { root: '', scannedAt: '', toolVersion: '', manifest: false, warnings: [] },
  skills: [],
  commands: [],
  agents: [],
  mcps: [],
  env: [],
  scripts: [],
  registries: [],
  health: {
    docs: { agentsMd: false, readme: false },
    ci: { workflows: [], husky: false },
    tests: { testScript: false, lintScript: false, typesScript: false },
  },
  catalog: { models: [] },
};

/** Live snapshot source: starts as the empty shell, replaced by /api/snapshot responses. */
let current = EMPTY_SNAPSHOT;

export function getSnapshot(): HarnessSnapshot {
  return current;
}

export function setSnapshot(next: HarnessSnapshot): void {
  current = next;
}
