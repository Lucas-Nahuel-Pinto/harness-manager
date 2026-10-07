import { describe, expect, test } from 'bun:test';
import { unifiedDiff } from '../src/actions/diff.ts';

describe('unifiedDiff', () => {
  test('identical inputs produce an empty diff', () => {
    expect(unifiedDiff('a\nb\nc', 'a\nb\nc', 'x.txt')).toBe('');
  });

  test('single line change: headers, hunk header and -/+ lines', () => {
    const diff = unifiedDiff('a\nb\nc', 'a\nB\nc', 'x.txt');
    expect(diff).toBe([
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1,3 +1,3 @@',
      ' a',
      '-b',
      '+B',
      ' c',
    ].join('\n'));
  });

  test('appended line shows up as + with correct counts', () => {
    const diff = unifiedDiff('a\nb', 'a\nb\nc', 'f');
    expect(diff).toBe([
      '--- a/f',
      '+++ b/f',
      '@@ -1,2 +1,3 @@',
      ' a',
      ' b',
      '+c',
    ].join('\n'));
  });

  test('distant changes produce two separate hunks', () => {
    const oldText = Array.from({ length: 20 }, (_, index) => `line${index + 1}`).join('\n');
    const newLines = oldText.split('\n');
    newLines[1] = 'CHANGED-2';
    newLines[18] = 'CHANGED-19';
    const diff = unifiedDiff(oldText, newLines.join('\n'), 'big.txt');
    expect(diff.match(/^@@ /gm)).toHaveLength(2);
    expect(diff).toContain('-line2');
    expect(diff).toContain('+CHANGED-2');
    expect(diff).toContain('-line19');
    expect(diff).toContain('+CHANGED-19');
    expect(diff.startsWith('--- a/big.txt\n+++ b/big.txt')).toBe(true);
  });

  test('context lines carry a leading space', () => {
    const diff = unifiedDiff('a\nb', 'a\nB', 'f');
    expect(diff).toContain('\n a\n');
  });

  test('whitespace-only difference still produces a diff', () => {
    const diff = unifiedDiff('a\nb\n', 'a\nb\n\n', 'f');
    expect(diff).toContain('+');
  });
});
