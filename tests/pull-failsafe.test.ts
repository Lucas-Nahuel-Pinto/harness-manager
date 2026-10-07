import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

const REPO_ROOT = join(import.meta.dir, '..');
const SNAPSHOT = join(REPO_ROOT, 'data', 'harness.json');

function snapshotState(): string | null {
  return existsSync(SNAPSHOT) ? readFileSync(SNAPSHOT, 'utf8') : null;
}

describe('pull fail-safe', () => {
  test('empty scan exits non-zero and never touches the last snapshot', async () => {
    const before = snapshotState();

    const proc = Bun.spawnSync(
      ['bun', join(REPO_ROOT, 'scripts', 'pull.ts'), '--root', join(import.meta.dir, 'fixtures', 'empty-harness')],
      { cwd: REPO_ROOT },
    );

    expect(proc.exitCode).not.toBe(0);
    const stderr = proc.stderr.toString();
    expect(stderr).toContain('ABORT');
    expect(stderr).toContain('empty scan');
    expect(snapshotState()).toBe(before);
  });

  test('nonexistent root exits non-zero by name', async () => {
    const proc = Bun.spawnSync(
      ['bun', join(REPO_ROOT, 'scripts', 'pull.ts'), '--root', join(import.meta.dir, 'fixtures', 'nope')],
      { cwd: REPO_ROOT },
    );
    expect(proc.exitCode).not.toBe(0);
    expect(proc.stderr.toString()).toContain('does not exist');
  });
});
