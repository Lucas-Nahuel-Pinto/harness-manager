import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { resolveInRoot } from '../src/actions/guard.ts';

const ROOT = resolve(import.meta.dir, 'fake-harness-root');

describe('resolveInRoot', () => {
  test('resolves a nested relative path inside the root', () => {
    expect(resolveInRoot(ROOT, 'cfg/opencode.jsonc')).toBe(resolve(ROOT, 'cfg', 'opencode.jsonc'));
  });

  test('rejects .. segments', () => {
    expect(resolveInRoot(ROOT, '../secret.txt')).toBeNull();
    expect(resolveInRoot(ROOT, 'a/../../secret.txt')).toBeNull();
    expect(resolveInRoot(ROOT, 'a\\..\\..\\secret.txt')).toBeNull();
  });

  test('rejects URL-encoded traversal (decoded once)', () => {
    expect(resolveInRoot(ROOT, '%2e%2e%2fsecret.txt')).toBeNull();
    expect(resolveInRoot(ROOT, '%2E%2E/secret.txt')).toBeNull();
  });

  test('double-encoded payload stays a literal filename inside the root', () => {
    const abs = resolveInRoot(ROOT, '%252e%252e%252fx.txt');
    expect(abs).toBe(resolve(ROOT, '%2e%2e%2fx.txt'));
  });

  test('rejects absolute POSIX paths', () => {
    expect(resolveInRoot(ROOT, '/etc/passwd')).toBeNull();
  });

  test('rejects Windows drives and UNC paths', () => {
    expect(resolveInRoot(ROOT, 'C:\\Windows\\system32')).toBeNull();
    expect(resolveInRoot(ROOT, 'd:/temp/x')).toBeNull();
    expect(resolveInRoot(ROOT, '\\\\srv\\share\\x')).toBeNull();
  });

  test('rejects NUL bytes, empty and non-string input', () => {
    expect(resolveInRoot(ROOT, 'a\0b')).toBeNull();
    expect(resolveInRoot(ROOT, '')).toBeNull();
    expect(resolveInRoot(ROOT, undefined as unknown as string)).toBeNull();
  });

  test('the root itself is not a valid target', () => {
    expect(resolveInRoot(ROOT, '.')).toBeNull();
    expect(resolveInRoot(ROOT, '..')).toBeNull();
  });

  test('malformed percent-encoding is treated as a literal filename', () => {
    const abs = resolveInRoot(ROOT, 'bad%zz.txt');
    expect(abs).toBe(resolve(ROOT, 'bad%zz.txt'));
  });
});
