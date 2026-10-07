import type { HarnessSnapshot } from './types.ts';
import raw from '../data/harness.json';

/** Live snapshot source: starts as the embedded (build-time) copy, replaced by /api/snapshot in serve mode. */
let current = raw as HarnessSnapshot;

export function getSnapshot(): HarnessSnapshot {
  return current;
}

export function setSnapshot(next: HarnessSnapshot): void {
  current = next;
}
