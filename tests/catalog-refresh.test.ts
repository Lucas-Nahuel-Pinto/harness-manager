import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'bun:test';
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

let root: string;
let catalogPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hm-refresh-'));
  cpSync(MINI, root, { recursive: true });
  catalogPath = join(root, '.models.catalog.json');
});

/** Force staleness by pinning the fixture's far-future fetchedAt back to the epoch. */
function makeStale(): string {
  const catalog = written(catalogPath);
  catalog.fetchedAt = 0;
  const text = `${JSON.stringify(catalog, null, 2)}\n`;
  writeFileSync(catalogPath, text, 'utf8');
  return text;
}

describe('refreshModelCatalog (via scanHarness)', () => {
  test('stale catalog + fake fetch → file rewritten, snapshot serves the fresh models', async () => {
    makeStale();
    const { fetchImpl, calls } = countingFetch(successRoutes());

    const { snapshot, error } = await scanHarness(root, { fetchImpl });

    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }
    expect(calls.length).toBeGreaterThan(0);
    expect(snapshot.meta.warnings.filter(w => w.startsWith('model catalog refresh'))).toHaveLength(0);

    const disk = written(catalogPath);
    expect(disk.fetchedAt).toBeGreaterThan(0);
    expect(disk.sources).toContain(ZEN);
    expect(disk.models.map(m => m.id)).toContain('opencode/grok-4');
    expect(snapshot.catalog.models.map(m => m.id)).toContain('opencode/grok-4');
  });

  test('all sources down → warning in the snapshot, scan succeeds, old file untouched', async () => {
    const before = makeStale();
    const { fetchImpl, calls } = countingFetch({});

    const { snapshot, error } = await scanHarness(root, { fetchImpl });

    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }
    expect(snapshot.meta.warnings).toContain('model catalog refresh failed (all sources)');
    expect(snapshot.catalog.models).toHaveLength(1);
    expect(readFileSync(catalogPath, 'utf8')).toBe(before);
    expect(calls.length).toBeGreaterThan(0);
  });

  test('harness without interest → fetch never invoked, nothing written', async () => {
    const { fetchImpl, calls } = countingFetch({});

    const { snapshot, error } = await scanHarness(MINIMAL, { fetchImpl });

    expect(error).toBeNull();
    expect(calls).toHaveLength(0);
    expect(existsSync(join(MINIMAL, '.models.catalog.json'))).toBe(false);
    expect(snapshot).not.toBeNull();
  });

  test('missing catalog but the harness declares models → file created', async () => {
    rmSync(catalogPath);
    writeFileSync(join(root, 'harness.json'), '{ "models": {} }\n', 'utf8');
    const { fetchImpl, calls } = countingFetch(successRoutes());

    const { snapshot, error } = await scanHarness(root, { fetchImpl });

    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }
    expect(calls.length).toBeGreaterThan(0);
    expect(existsSync(catalogPath)).toBe(true);
    expect(written(catalogPath).fetchedAt).toBeGreaterThan(0);
    expect(snapshot.catalog.models.map(m => m.id)).toContain('opencode/grok-4');
  });

  test('fresh catalog → served from cache, fetch never invoked', async () => {
    const { fetchImpl, calls } = countingFetch({});

    const { snapshot, error } = await scanHarness(root, { fetchImpl });

    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }
    expect(calls).toHaveLength(0);
    expect(snapshot.catalog.models).toHaveLength(1);
  });
});
