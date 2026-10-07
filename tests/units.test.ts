import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { asStringArray, extractTriggers, parseFrontmatter } from '../src/scan/frontmatter.ts';
import { envRefsIn, parseJsonc, stripJsonComments } from '../src/scan/jsonc.ts';
import { loadManifest } from '../src/scan/manifest.ts';

describe('parseFrontmatter', () => {
  test('parses a normal frontmatter block', () => {
    const fm = parseFrontmatter('---\nname: demo\ntags: [a, b]\n---\nbody');
    expect(fm.ok).toBe(true);
    expect(fm.data.name).toBe('demo');
    expect(asStringArray(fm.data.tags)).toEqual(['a', 'b']);
    expect(fm.body).toBe('body');
  });

  test('malformed YAML never throws', () => {
    const fm = parseFrontmatter('---\nname: [unclosed\n---\nbody');
    expect(fm.ok).toBe(false);
    expect(fm.body).toContain('body');
  });

  test('missing frontmatter passes body through', () => {
    const fm = parseFrontmatter('just text');
    expect(fm.ok).toBe(false);
    expect(fm.body).toBe('just text');
  });
});

describe('extractTriggers', () => {
  test('extracts triggers and stops at Do NOT use', () => {
    const triggers = extractTriggers('Does X. Triggers on: do thing, other thing. Do NOT use for Y.');
    expect(triggers.length).toBeGreaterThanOrEqual(2);
    expect(triggers.join(' ')).toContain('do thing');
    expect(triggers.join(' ')).not.toContain('for Y');
  });

  test('no marker yields empty list', () => {
    expect(extractTriggers('No markers here.')).toEqual([]);
  });
});

describe('jsonc helpers', () => {
  test('strips comments but preserves URLs inside strings', () => {
    const input = `{
  // line comment
  "url": "https://example.com/x", /* block */
  "keep": "https://not-a-comment"
}`;
    const parsed = parseJsonc<{ url: string, keep: string }>(stripJsonComments(input));
    expect(parsed.error).toBeNull();
    expect(parsed.value?.url).toBe('https://example.com/x');
    expect(parsed.value?.keep).toBe('https://not-a-comment');
  });

  test('invalid JSON reports an error instead of throwing', () => {
    const parsed = parseJsonc('{ broken');
    expect(parsed.value).toBeNull();
    expect(parsed.error).toBeTruthy();
  });

  test('envRefsIn finds both styles', () => {
    const refs = envRefsIn({ a: '{env:FOO}', b: ['$' + '{BAR}'], c: 'plain' });
    expect(refs.sort()).toEqual(['BAR', 'FOO']);
  });
});

describe('loadManifest', () => {
  test('absent manifest is not an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hm-'));
    const result = loadManifest(dir);
    expect(result.present).toBe(false);
    expect(result.error).toBeNull();
  });

  test('valid manifest is parsed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hm-'));
    writeFileSync(join(dir, 'harness.json'), '{ "skills": ["custom"] }');
    const result = loadManifest(dir);
    expect(result.present).toBe(true);
    expect(result.manifest.skills).toEqual(['custom']);
  });

  test('invalid manifest surfaces a warning, not a crash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hm-'));
    writeFileSync(join(dir, 'harness.json'), '{ nope');
    const result = loadManifest(dir);
    expect(result.present).toBe(true);
    expect(result.error).toContain('harness.json');
  });
});
