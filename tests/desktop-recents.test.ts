import type { RecentEntry } from '../src/desktop/recents.ts';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { addRecent, loadRecents, RECENTS_CAP, saveRecents } from '../src/desktop/recents.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'hm-recents-'));
}

describe('RECENTS_CAP', () => {
  test('spec §3.5 cap is 10', () => {
    expect(RECENTS_CAP).toBe(10);
  });
});

describe('addRecent (pure MRU)', () => {
  test('move-to-front + lastUsed stamp, input list never mutated', () => {
    const list = [
      { path: '/roots/a', lastUsed: 300 },
      { path: '/roots/b', lastUsed: 200 },
      { path: '/roots/c', lastUsed: 100 },
    ];
    const next = addRecent(list, '/roots/b', { now: () => 400, platform: 'linux' });
    expect(next.map(entry => entry.path)).toEqual(['/roots/b', '/roots/a', '/roots/c']);
    expect(next[0].lastUsed).toBe(400);
    expect(list.map(entry => entry.path)).toEqual(['/roots/a', '/roots/b', '/roots/c']);
  });

  test('re-adding a path dedupes and refreshes lastUsed at the front', () => {
    const list = [{ path: '/roots/a', lastUsed: 300 }, { path: '/roots/b', lastUsed: 200 }];
    const next = addRecent(list, '/roots/a', { now: () => 999, platform: 'linux' });
    expect(next).toEqual([
      { path: '/roots/a', lastUsed: 999 },
      { path: '/roots/b', lastUsed: 200 },
    ]);
  });

  test('win32 dedupe is case- and separator-insensitive', () => {
    const list = [{ path: 'c:\\harnesses\\demo', lastUsed: 10 }];
    const next = addRecent(list, 'C:/Harnesses/Demo', { now: () => 20, platform: 'win32' });
    expect(next).toEqual([{ path: 'C:/Harnesses/Demo', lastUsed: 20 }]);
  });

  test('non-win32 dedupe is exact (case-sensitive on linux)', () => {
    const list = [{ path: '/roots/A', lastUsed: 10 }];
    const next = addRecent(list, '/roots/a', { now: () => 20, platform: 'linux' });
    expect(next).toEqual([
      { path: '/roots/a', lastUsed: 20 },
      { path: '/roots/A', lastUsed: 10 },
    ]);
  });

  test('default cap keeps the 10 most recent, newest first', () => {
    let list: RecentEntry[] = [];
    for (let i = 0; i < 12; i++) { list = addRecent(list, `/roots/r${i}`, { now: () => i, platform: 'linux' }); }
    expect(list).toHaveLength(RECENTS_CAP);
    expect(list[0].path).toBe('/roots/r11');
    expect(list[RECENTS_CAP - 1].path).toBe('/roots/r2');
  });

  test('custom cap overrides the default', () => {
    const list = addRecent([], '/roots/a', { cap: 2, platform: 'linux' });
    const next = addRecent(list, '/roots/b', { cap: 2, now: () => 5, platform: 'linux' });
    expect(next.map(entry => entry.path)).toEqual(['/roots/b', '/roots/a']);
  });
});

describe('loadRecents / saveRecents', () => {
  test('missing file → []', () => {
    expect(loadRecents(join(tempDir(), 'nope.json'))).toEqual([]);
  });

  test('corrupt JSON → []', () => {
    const dir = tempDir();
    try {
      const file = join(dir, 'recents.json');
      writeFileSync(file, '{not json', 'utf8');
      expect(loadRecents(file)).toEqual([]);
    }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('wrong shape → [] and malformed entries are dropped', () => {
    const dir = tempDir();
    try {
      const file = join(dir, 'recents.json');
      writeFileSync(file, JSON.stringify({ path: '/x' }), 'utf8');
      expect(loadRecents(file)).toEqual([]);
      writeFileSync(file, JSON.stringify([{ path: '/ok', lastUsed: 1 }, { path: 2 }, null, 'x']), 'utf8');
      expect(loadRecents(file)).toEqual([{ path: '/ok', lastUsed: 1 }]);
    }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('save → load roundtrip preserves MRU order and timestamps', () => {
    const dir = tempDir();
    try {
      const file = join(dir, 'recents.json');
      const entries = [
        { path: 'C:\\roots\\niño', lastUsed: 2 },
        { path: '/opt/harness demo', lastUsed: 1 },
      ];
      saveRecents(file, entries);
      expect(loadRecents(file)).toEqual(entries);
    }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('atomic write leaves no .tmp behind (even overwriting an existing file)', () => {
    const dir = tempDir();
    try {
      const file = join(dir, 'recents.json');
      saveRecents(file, [{ path: '/roots/a', lastUsed: 1 }]);
      saveRecents(file, [{ path: '/roots/b', lastUsed: 2 }, { path: '/roots/a', lastUsed: 1 }]);
      expect(readdirSync(dir)).toEqual(['recents.json']);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([
        { path: '/roots/b', lastUsed: 2 },
        { path: '/roots/a', lastUsed: 1 },
      ]);
    }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
