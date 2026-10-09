import type { ModelCatalog } from '../src/catalog/cache.ts';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { declaresInterest, DEFAULT_TTL_MS, isStale, readCatalog, writeCatalogAtomic } from '../src/catalog/cache.ts';

function makeCatalog(fetchedAt: number): ModelCatalog {
  return {
    models: [{ id: 'opencode/grok-4', name: 'Grok 4', provider: 'xai', source: 'https://zen.test', capabilities: [] }],
    fetchedAt,
    sources: ['https://zen.test'],
  };
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'hm-catalog-'));
}

describe('readCatalog', () => {
  test('missing file → null', () => {
    expect(readCatalog(join(tempRoot(), 'nope.json'))).toBeNull();
  });

  test('invalid JSON → null', () => {
    const path = join(tempRoot(), '.models.catalog.json');
    writeFileSync(path, '{ not json', 'utf8');
    expect(readCatalog(path)).toBeNull();
  });

  test('wrong shape → null', () => {
    const root = tempRoot();
    const wrongModels = join(root, 'a.json');
    writeFileSync(wrongModels, JSON.stringify({ models: 'nope', fetchedAt: 1, sources: [] }), 'utf8');
    expect(readCatalog(wrongModels)).toBeNull();

    const missingSources = join(root, 'b.json');
    writeFileSync(missingSources, JSON.stringify({ models: [], fetchedAt: 1 }), 'utf8');
    expect(readCatalog(missingSources)).toBeNull();
  });

  test('valid catalog round-trips', () => {
    const path = join(tempRoot(), '.models.catalog.json');
    const catalog = makeCatalog(1_700_000_000_000);
    writeFileSync(path, JSON.stringify(catalog), 'utf8');
    expect(readCatalog(path)).toEqual(catalog);
  });
});

describe('writeCatalogAtomic', () => {
  test('writes the catalog and leaves no .tmp behind', () => {
    const path = join(tempRoot(), '.models.catalog.json');
    const catalog = makeCatalog(100);
    writeCatalogAtomic(path, catalog);

    expect(readCatalog(path)).toEqual(catalog);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  test('creates missing parent directories', () => {
    const path = join(tempRoot(), 'nested', 'deeper', 'catalog.json');
    writeCatalogAtomic(path, makeCatalog(1));
    expect(readCatalog(path)).not.toBeNull();
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  test('overwrite replaces content atomically (no torn state, no .tmp)', () => {
    const path = join(tempRoot(), '.models.catalog.json');
    writeCatalogAtomic(path, makeCatalog(1));
    writeCatalogAtomic(path, makeCatalog(2));

    const raw = JSON.parse(readFileSync(path, 'utf8')) as ModelCatalog;
    expect(raw.fetchedAt).toBe(2);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });
});

describe('isStale', () => {
  const catalog = makeCatalog(1_000);

  test('TTL boundaries: fresh at TTL-1ms and at TTL, stale at TTL+1ms', () => {
    expect(isStale(catalog, 1_000, 1_999)).toBe(false);
    expect(isStale(catalog, 1_000, 2_000)).toBe(false);
    expect(isStale(catalog, 1_000, 2_001)).toBe(true);
  });

  test('default TTL is 24h', () => {
    expect(DEFAULT_TTL_MS).toBe(86_400_000);
    const now = Date.now();
    expect(isStale(makeCatalog(now), DEFAULT_TTL_MS, now)).toBe(false);
    expect(isStale(makeCatalog(now - DEFAULT_TTL_MS), DEFAULT_TTL_MS, now)).toBe(false);
    expect(isStale(makeCatalog(now - DEFAULT_TTL_MS - 1), DEFAULT_TTL_MS, now)).toBe(true);
  });

  test('future fetchedAt is fresh', () => {
    expect(isStale(makeCatalog(10_000), 1_000, 1_000)).toBe(false);
  });
});

describe('declaresInterest', () => {
  test('manifest declaring models → true (no file, no package.json needed)', () => {
    expect(declaresInterest(tempRoot(), { models: {} })).toBe(true);
    expect(declaresInterest(tempRoot(), { models: { catalog: 'custom.json' } })).toBe(true);
  });

  test('existing catalog file at root → true', () => {
    const root = tempRoot();
    expect(declaresInterest(root, null)).toBe(false);
    writeFileSync(join(root, '.models.catalog.json'), '{}', 'utf8');
    expect(declaresInterest(root, null)).toBe(true);
  });

  test('manifest-declared catalog filename is honored via catalogFile param', () => {
    const root = tempRoot();
    writeFileSync(join(root, 'custom.catalog.json'), '{}', 'utf8');
    expect(declaresInterest(root, null, 'custom.catalog.json')).toBe(true);
    expect(declaresInterest(root, null)).toBe(false); // default name absent
  });

  test('package.json harness-config script → true', () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { 'harness-config': 'bun scripts/x.ts' } }), 'utf8');
    expect(declaresInterest(root, null)).toBe(true);
  });

  test('negative: nothing declared, no file, no harness-config → false', () => {
    const root = tempRoot();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'bun test' } }), 'utf8');
    expect(declaresInterest(root, null)).toBe(false);
    expect(declaresInterest(root, {})).toBe(false);
    expect(declaresInterest(root, null)).toBe(false);
  });

  test('malformed package.json never throws', () => {
    const root = tempRoot();
    writeFileSync(join(root, 'package.json'), '{ broken', 'utf8');
    expect(declaresInterest(root, null)).toBe(false);
  });
});
