import type { ComputeResult } from '../src/actions/types.ts';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'bun:test';
import { computeModelSet } from '../src/actions/model-set.ts';
import { scanHarness } from '../src/scan/index.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mini-harness');
const MAIN_ID = 'agent:opencode.jsonc';
const HELPER_ID = 'agent:.opencode/agents/helper.md';

let root: string;
let helperPath: string;
let mainPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hm-model-'));
  cpSync(FIXTURE, root, { recursive: true });
  helperPath = join(root, '.opencode', 'agents', 'helper.md');
  mainPath = join(root, 'opencode.jsonc');
});

function expectOk(result: ComputeResult): Extract<ComputeResult, { ok: true }> {
  if (!result.ok) { throw new Error(`expected ok, got ${result.code}: ${result.detail}`); }
  return result;
}

function expectFail(result: ComputeResult, code: string, status = 400): void {
  expect(result.ok).toBe(false);
  if (result.ok) { return; }
  expect(result.code).toBe(code);
  expect(result.status).toBe(status);
}

describe('computeModelSet — subagent (frontmatter)', () => {
  test('rewrites only the model line, everything else byte-identical', () => {
    const original = readFileSync(helperPath, 'utf8');
    const originalLines = original.split('\n');

    const result = expectOk(computeModelSet(root, { agentId: HELPER_ID, model: 'opencode/demo-model' }));
    const newLines = result.computed.newText.split('\n');

    expect(result.computed.newText).toContain('model: opencode/demo-model');
    expect(newLines).toHaveLength(originalLines.length);
    const changed = originalLines.filter((line, index) => newLines[index] !== line);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('model: deepseek/deepseek-flash');
    expect(result.computed.summary).toContain('opencode/demo-model');
  });

  test('same model is a no-op edit', () => {
    const result = expectOk(computeModelSet(root, { agentId: HELPER_ID, model: 'deepseek/deepseek-flash' }));
    expect(result.computed.newText).toBe(result.computed.oldText);
    expect(result.computed.summary).toContain('(sin cambios)');
  });

  test('model outside the catalog and not current → invalid_model', () => {
    expectFail(
      computeModelSet(root, { agentId: HELPER_ID, model: 'unknown/provider-model' }),
      'invalid_model',
    );
  });

  test('unknown agent → agent_not_found', () => {
    expectFail(computeModelSet(root, { agentId: 'agent:ghost.md', model: 'opencode/demo-model' }), 'agent_not_found');
  });

  test('subagent without frontmatter → no_frontmatter', () => {
    writeFileSync(helperPath, 'Just plain text, no frontmatter here.\n');
    expectFail(computeModelSet(root, { agentId: HELPER_ID, model: 'opencode/demo-model' }), 'no_frontmatter');
  });

  test('frontmatter without model line gets one inserted after the opening ---', () => {
    writeFileSync(helperPath, '---\ndescription: no model yet\n---\nbody\n');
    const result = expectOk(computeModelSet(root, { agentId: HELPER_ID, model: 'opencode/demo-model' }));
    const lines = result.computed.newText.split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[1]).toBe('model: opencode/demo-model');
    expect(result.computed.newText).toContain('description: no model yet');
  });
});

describe('computeModelSet — main session (opencode.jsonc)', () => {
  test('replaces the model value and keeps the rest of the file intact', () => {
    const original = readFileSync(mainPath, 'utf8');
    const result = expectOk(computeModelSet(root, { agentId: MAIN_ID, model: 'opencode/demo-model' }));

    expect(result.computed.newText).toContain('"model": "opencode/demo-model"');
    expect(result.computed.newText).not.toContain('opencode/mimo-v2.6-flash-free');
    // only the value span changed: same line count, one differing line
    const oldLines = original.split('\n');
    const newLines = result.computed.newText.split('\n');
    expect(newLines).toHaveLength(oldLines.length);
    const changed = oldLines.filter((line, index) => newLines[index] !== line);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('"model"');
    expect(result.computed.summary).toContain('agente principal');
  });

  test('main may keep its current model even when it is not in the catalog', () => {
    const result = expectOk(computeModelSet(root, { agentId: MAIN_ID, model: 'opencode/mimo-v2.6-flash-free' }));
    expect(result.computed.newText).toBe(result.computed.oldText);
    expect(result.computed.summary).toContain('(sin cambios)');
  });

  test('applied change is visible on the next scan', () => {
    const result = expectOk(computeModelSet(root, { agentId: HELPER_ID, model: 'opencode/demo-model' }));
    writeFileSync(helperPath, result.computed.newText);

    const { snapshot, error } = scanHarness(root);
    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }
    const helper = snapshot.agents.find(agent => !agent.isMain);
    expect(helper?.model).toBe('opencode/demo-model');
  });
});
