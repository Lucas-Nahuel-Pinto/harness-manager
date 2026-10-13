import type { ComputeResult } from '../src/actions/types.ts';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

describe('computeMcpToggle — .mcp.json goes through .claude/settings.json', () => {
  const SETTINGS = '.claude/settings.json';

  function writeSettings(content: string): void {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, SETTINGS), content);
  }

  test('disable creates .claude/settings.json and leaves .mcp.json byte-identical', () => {
    const original = read('.mcp.json');
    const result = expectOk(computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: false }));

    expect(result.computed.relPath).toBe(SETTINGS);
    expect(result.computed.oldText).toBe('');
    expect(result.computed.summary).toContain('Deshabilitar');
    const parsed = parseJsonc<{ disabledMcpjsonServers: string[] }>(result.computed.newText);
    expect(parsed.value?.disabledMcpjsonServers).toEqual(['gamma']);
    expect(read('.mcp.json')).toBe(original); // the config file is never touched by this path
  });

  test('disable appends to an existing array, preserving keys, formatting and comments', () => {
    const original = '{\n  // project settings\n  "model": "opus",\n  "disabledMcpjsonServers": ["other"]\n}\n';
    writeSettings(original);
    const result = expectOk(computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: false }));

    expect(result.computed.relPath).toBe(SETTINGS);
    expect(result.computed.oldText).toBe(original);
    expect(result.computed.newText).toContain('// project settings');
    expect(result.computed.newText).toContain('"model": "opus"');
    const parsed = parseJsonc<{ disabledMcpjsonServers: string[] }>(result.computed.newText);
    expect(parsed.value?.disabledMcpjsonServers).toEqual(['other', 'gamma']);
  });

  test('disable → enable roundtrip restores a pre-existing settings file byte-exact', () => {
    const original = '{\n  "model": "opus"\n}\n';
    writeSettings(original);
    const disabled = expectOk(computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: false }));
    writeSettings(disabled.computed.newText);

    const enabled = expectOk(computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: true }));
    expect(enabled.computed.relPath).toBe(SETTINGS);
    expect(enabled.computed.newText).toBe(original);
  });

  test('enable that empties the array removes the key entirely', () => {
    const disabled = expectOk(computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: false }));
    writeSettings(disabled.computed.newText);

    const enabled = expectOk(computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: true }));
    expect(enabled.computed.newText).toBe('{}\n');
    expect(enabled.computed.newText).not.toContain('disabledMcpjsonServers');
  });

  test('disable when the name is already listed is a no-op on the settings file', () => {
    const original = '{\n  "disabledMcpjsonServers": ["gamma"]\n}\n';
    writeSettings(original);
    const result = expectOk(computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: false }));

    expect(result.computed.relPath).toBe(SETTINGS);
    expect(result.computed.newText).toBe(original);
    expect(result.computed.summary).toContain('(sin cambios)');
  });

  test('legacy enabled:false marker: disable no-ops, enable strips the marker from .mcp.json', () => {
    const legacy = '{\n  // legacy toggle state\n  "mcpServers": {\n    "gamma": {\n      "enabled": false,\n      "command": "npx"\n    }\n  }\n}\n';
    writeFileSync(join(root, '.mcp.json'), legacy);

    const noop = expectOk(computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: false }));
    expect(noop.computed.relPath).toBe('.mcp.json');
    expect(noop.computed.newText).toBe(legacy);
    expect(noop.computed.summary).toContain('(sin cambios)');

    const enabled = expectOk(computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: true }));
    expect(enabled.computed.relPath).toBe('.mcp.json');
    expect(enabled.computed.newText).not.toContain('"enabled"');
    expect(enabled.computed.newText).toContain('// legacy toggle state');
    const parsed = parseJsonc<{ mcpServers: Record<string, { command: string }> }>(enabled.computed.newText);
    expect(parsed.value?.mcpServers.gamma.command).toBe('npx');
  });

  test('legacy marker AND array both holding the name: enable removes the array entry first', () => {
    writeSettings('{\n  "disabledMcpjsonServers": ["gamma"]\n}\n');
    writeFileSync(join(root, '.mcp.json'), '{\n  "mcpServers": {\n    "gamma": {\n      "enabled": false,\n      "command": "npx"\n    }\n  }\n}\n');

    const first = expectOk(computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: true }));
    expect(first.computed.relPath).toBe(SETTINGS);
    expect(first.computed.newText).toBe('{}\n');
  });

  test('invalid settings JSON → config_invalid', () => {
    writeSettings('{broken');
    expectFail(
      computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: false }),
      'config_invalid',
    );
  });

  test('disabledMcpjsonServers with the wrong shape → config_invalid', () => {
    writeSettings('{\n  "disabledMcpjsonServers": "gamma"\n}\n');
    expectFail(
      computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: false }),
      'config_invalid',
    );
    writeSettings('{\n  "disabledMcpjsonServers": ["gamma", 42]\n}\n');
    expectFail(
      computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: false }),
      'config_invalid',
    );
  });

  test('settings root that is not an object → config_invalid', () => {
    writeSettings('["gamma"]\n');
    expectFail(
      computeMcpToggle(root, { configFile: '.mcp.json', name: 'gamma', enable: false }),
      'config_invalid',
    );
  });
});
