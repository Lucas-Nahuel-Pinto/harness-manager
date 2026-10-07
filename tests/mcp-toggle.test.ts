import type { ComputeResult } from '../src/actions/types.ts';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'bun:test';
import { computeMcpToggle } from '../src/actions/mcp-toggle.ts';
import { parseJsonc } from '../src/scan/jsonc.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'jsonc-harness');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hm-toggle-'));
  cpSync(FIXTURE, root, { recursive: true });
});

function read(name: string): string {
  return readFileSync(join(root, name), 'utf8');
}

function expectOk(result: ComputeResult): Extract<ComputeResult, { ok: true }> {
  if (!result.ok) { throw new Error(`expected ok, got ${result.code}: ${result.detail}`); }
  return result;
}

function expectFail(result: ComputeResult, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) { return; }
  expect(result.code).toBe(code);
  expect(result.status).toBe(400);
}

describe('computeMcpToggle', () => {
  test('disable inserts enabled:false and keeps every comment', () => {
    const original = read('opencode.jsonc');
    const result = expectOk(computeMcpToggle(root, { configFile: 'opencode.jsonc', name: 'alpha', enable: false }));

    expect(result.computed.oldText).toBe(original);
    expect(result.computed.newText).not.toBe(original);
    expect(result.computed.summary).toContain('Deshabilitar');

    const parsed = parseJsonc<{ mcp: Record<string, { enabled?: boolean }> }>(result.computed.newText);
    expect(parsed.value?.mcp.alpha.enabled).toBe(false);
    expect(result.computed.newText).toContain('// inner comment must survive');
    expect(result.computed.newText).toContain('// comment at top level must survive');
    // untouched sibling entry stays byte-identical
    expect(result.computed.newText).toContain('"command": "bun"');
  });

  test('disable → enable roundtrip restores the original bytes', () => {
    const original = read('opencode.jsonc');
    const disabled = expectOk(computeMcpToggle(root, { configFile: 'opencode.jsonc', name: 'alpha', enable: false }));
    writeFileSync(join(root, 'opencode.jsonc'), disabled.computed.newText);

    const enabled = expectOk(computeMcpToggle(root, { configFile: 'opencode.jsonc', name: 'alpha', enable: true }));
    expect(enabled.computed.newText).toBe(original);
  });

  test('toggle inside .mcp.json uses the mcpServers section', () => {
    const original = read('.mcp.json');
    const disabled = expectOk(computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: false }));

    const parsed = parseJsonc<{ mcpServers: Record<string, { enabled?: boolean }> }>(disabled.computed.newText);
    expect(parsed.value?.mcpServers.gamma.enabled).toBe(false);
    expect(disabled.computed.newText).toContain('claude code has no enabled flag');
    expect(disabled.computed.oldText).toBe(original);

    writeFileSync(join(root, '.mcp.json'), disabled.computed.newText);
    const enabled = expectOk(computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: true }));
    expect(enabled.computed.newText).toBe(original);
  });

  test('repeating the current state is a no-op edit', () => {
    const original = read('opencode.jsonc');
    const again = expectOk(computeMcpToggle(root, { configFile: 'opencode.jsonc', name: 'alpha', enable: true }));
    expect(again.computed.newText).toBe(original);
    expect(again.computed.summary).toContain('(sin cambios)');
  });

  test('unknown server name → mcp_not_found', () => {
    expectFail(
      computeMcpToggle(root, { configFile: 'opencode.jsonc', name: 'ghost', enable: false }),
      'mcp_not_found',
    );
  });

  test('config file outside the allowlist → bad_payload', () => {
    expectFail(
      computeMcpToggle(root, { configFile: 'package.json', name: 'alpha', enable: false }),
      'bad_payload',
    );
    expectFail(
      computeMcpToggle(root, { configFile: '../opencode.jsonc', name: 'alpha', enable: false }),
      'bad_payload',
    );
  });

  test('malformed payload shapes → bad_payload', () => {
    expectFail(computeMcpToggle(root, { configFile: 'opencode.jsonc', name: '', enable: false }), 'bad_payload');
    expectFail(computeMcpToggle(root, { configFile: 'opencode.jsonc', name: 'alpha', enable: 'no' }), 'bad_payload');
    expectFail(computeMcpToggle(root, { configFile: 'opencode.jsonc' }), 'bad_payload');
  });

  test('missing config file → config_not_found', () => {
    rmSync(join(root, 'opencode.jsonc'));
    expectFail(
      computeMcpToggle(root, { configFile: 'opencode.jsonc', name: 'alpha', enable: false }),
      'config_not_found',
    );
  });
});
