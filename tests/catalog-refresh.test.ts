import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { scanHarness } from '../src/scan/index.ts';

const FIXTURES = join(import.meta.dir, 'fixtures');
const MINI = join(FIXTURES, 'mini-harness');
const MINIMAL = join(FIXTURES, 'minimal-harness');

const ZEN = 'https://opencode.ai/zen/v1/models';
const ZEN_GO = 'https://opencode.ai/zen/go/v1/models';
const MODELS_DEV = 'https://models.dev/api.json';
const EMPTY_DEV = { opencode: { models: {} } };

interface WrittenCatalog {
  fetchedAt: number
  models: Array<{ id: string }>
  sources: string[]
}

interface CountingFake {
  fetchImpl: typeof fetch
  calls: string[]
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

/** Route-aware counting fake — unrouted URLs throw (caught per source), so no request ever hits the network. */
function countingFetch(routes: Record<string, Response | (() => Response)>): CountingFake {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url === prefix || url.startsWith(`${prefix}?`)) {
        return typeof handler === 'function' ? handler() : handler.clone();
      }
    }
    throw new Error(`unrouted fetch: ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function successRoutes(): Record<string, Response> {
  return {
    [ZEN]: json({ data: [{ id: 'grok-4', owned_by: 'xai' }] }),
    [ZEN_GO]: json({ data: [{ id: 'glm-5.3', owned_by: 'zhipu' }] }),
    [MODELS_DEV]: json(EMPTY_DEV),
  };
}

function written(catalogPath: string): WrittenCatalog {
  return JSON.parse(readFileSync(catalogPath, 'utf8')) as WrittenCatalog;
}

/** Point the shared store seam at a fresh temp path for the current test. */
const SAVED_STORE_ENV = process.env.MODELS_CATALOG_PATH;

let root: string;
let store: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hm-refresh-'));
  cpSync(MINI, root, { recursive: true });
  store = join(mkdtempSync(join(tmpdir(), 'hm-store-')), 'models.catalog.json');
  process.env.MODELS_CATALOG_PATH = store;
});

afterEach(() => {
  if (SAVED_STORE_ENV === undefined) { delete process.env.MODELS_CATALOG_PATH; }
  else { process.env.MODELS_CATALOG_PATH = SAVED_STORE_ENV; }
});

/** Seed a stale store (fetchedAt pinned to the epoch) and return its exact text. */
function seedStaleStore(models: WrittenCatalog['models']): string {
  const text = `${JSON.stringify({ models, fetchedAt: 0, sources: ['test://stale'] }, null, 2)}\n`;
  writeFileSync(store, text, 'utf8');
  return text;
}

describe('refreshModelCatalog (shared store, via scanHarness)', () => {
  test('stale store + fake fetch → store rewritten, snapshot serves the fresh models', async () => {
    seedStaleStore([{ id: 'opencode/old-model' }]);
    const { fetchImpl, calls } = countingFetch(successRoutes());

    const { snapshot, error } = await scanHarness(root, { fetchImpl });

    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }
    expect(calls.length).toBeGreaterThan(0);
    expect(snapshot.meta.warnings.filter(w => w.startsWith('model catalog refresh'))).toHaveLength(0);

    const disk = written(store);
    expect(disk.fetchedAt).toBeGreaterThan(0);
    expect(disk.sources).toContain(ZEN);
    expect(disk.models.map(m => m.id)).toContain('opencode/grok-4');
    expect(snapshot.catalog.models.map(m => m.id)).toContain('opencode/grok-4');
  });

  test('all sources down → warning in the snapshot, scan succeeds, old store untouched', async () => {
    const before = seedStaleStore([{ id: 'opencode/old-model' }]);
    const { fetchImpl, calls } = countingFetch({});

    const { snapshot, error } = await scanHarness(root, { fetchImpl });

    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }
    expect(snapshot.meta.warnings).toContain('model catalog refresh failed (all sources)');
    expect(snapshot.catalog.models).toHaveLength(1);
    expect(readFileSync(store, 'utf8')).toBe(before);
    expect(calls.length).toBeGreaterThan(0);
  });

  test('missing store + ANY harness (even a bare minimal one) → fetch invoked, store created', async () => {
    expect(existsSync(store)).toBe(false);
    const { fetchImpl, calls } = countingFetch(successRoutes());

    const { snapshot, error } = await scanHarness(MINIMAL, { fetchImpl });

    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }
    expect(calls.length).toBeGreaterThan(0);
    expect(existsSync(store)).toBe(true);
    expect(written(store).fetchedAt).toBeGreaterThan(0);
    expect(snapshot.catalog.models.map(m => m.id)).toContain('opencode/grok-4');
  });

  test('fresh store → served from cache, fetch never invoked', async () => {
    seedStaleStore([{ id: 'opencode/cached-model' }]);
    writeFileSync(
      store,
      `${JSON.stringify({ models: [{ id: 'opencode/cached-model' }], fetchedAt: Date.now(), sources: ['test://cache'] }, null, 2)}\n`,
      'utf8',
    );
    const { fetchImpl, calls } = countingFetch({});

    const { snapshot, error } = await scanHarness(root, { fetchImpl });

    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }
    expect(calls).toHaveLength(0);
    expect(snapshot.catalog.models.map(m => m.id)).toEqual(['opencode/cached-model']);
  });

  test('the harness root is never written to (no .models.catalog.json appears anywhere)', async () => {
    const before = readFileSync(join(root, 'package.json'), 'utf8');
    const { fetchImpl } = countingFetch(successRoutes());

    await scanHarness(root, { fetchImpl });

    expect(existsSync(join(root, '.models.catalog.json'))).toBe(false);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
  });

  test('a stale per-harness .models.catalog.json left over from option A is ignored', async () => {
    // The engine reads ONLY the shared store — a leftover file in the root must not leak in.
    writeFileSync(
      join(root, '.models.catalog.json'),
      `${JSON.stringify({ models: [{ id: 'opencode/ghost-model' }], fetchedAt: 0, sources: [] }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      store,
      `${JSON.stringify({ models: [{ id: 'opencode/store-model' }], fetchedAt: Date.now(), sources: [] }, null, 2)}\n`,
      'utf8',
    );
    const { fetchImpl, calls } = countingFetch({});

    const { snapshot, error } = await scanHarness(root, { fetchImpl });

    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }
    expect(calls).toHaveLength(0); // fresh store → no fetch, whatever the root contains
    expect(snapshot.catalog.models.map(m => m.id)).toEqual(['opencode/store-model']);
    rmSync(join(root, '.models.catalog.json'));
  });
});
