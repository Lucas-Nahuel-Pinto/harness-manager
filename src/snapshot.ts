import type { HarnessSnapshot } from './types.ts';
import raw from '../data/harness.json';

/** Empty shell for online builds: `dist-online/` must contain ZERO embedded harness data. */
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

// `__HM_ONLINE__` is a Vite build-time define; typeof-guarded so Bun tests (where it is
// undefined) keep embedding the real snapshot. Online UI shows "Esperando motor…" until the
// engine's snapshot arrives over the relay.
const embedded: HarnessSnapshot
  = typeof __HM_ONLINE__ !== 'undefined' && __HM_ONLINE__
    ? EMPTY_SNAPSHOT
    : raw as HarnessSnapshot;

/** Live snapshot source: starts as the embedded (build-time) copy, replaced by /api/snapshot in serve mode. */
let current = embedded;

export function getSnapshot(): HarnessSnapshot {
  return current;
}

export function setSnapshot(next: HarnessSnapshot): void {
  current = next;
}
