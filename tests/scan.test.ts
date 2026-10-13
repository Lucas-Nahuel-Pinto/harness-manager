import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { scanHarness } from '../src/scan/index.ts';

const FIXTURES = join(import.meta.dir, 'fixtures');

describe('scanHarness', () => {
  test('mini harness covers every element group', async () => {
    const { snapshot, error } = await scanHarness(join(FIXTURES, 'mini-harness'));
    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }

    expect(snapshot.schemaVersion).toBe(1);

    expect(snapshot.skills).toHaveLength(1);
    const skill = snapshot.skills[0];
    expect(skill.name).toBe('demo-skill');
    expect(skill.tier).toBe('T1');
    expect(skill.registered).toBe(true); // REGISTRY.md lists ## Skill: demo-skill
    expect(skill.refs).toContain('references/notes.md');
    expect(skill.triggers.length).toBeGreaterThan(0);
    expect(skill.evals).toBe(false);

    expect(snapshot.commands).toHaveLength(1);
    expect(snapshot.commands[0].name).toBe('ship');

    expect(snapshot.agents).toHaveLength(2);
    const main = snapshot.agents.find(a => a.isMain);
    expect(main?.model).toBe('opencode/mimo-v2.6-flash-free');
    const helper = snapshot.agents.find(a => !a.isMain);
    expect(helper?.model).toBe('deepseek/deepseek-flash');
    expect(helper?.host).toBe('opencode');

    expect(snapshot.mcps).toHaveLength(2);
    const tavily = snapshot.mcps.find(m => m.configFile === 'opencode.jsonc');
    expect(tavily?.envRefs).toEqual(['TAVILY_API_KEY']);
    const context7 = snapshot.mcps.find(m => m.configFile === '.mcp.json');
    expect(context7?.envRefs).toEqual(['CONTEXT7_API_KEY']);

    expect(snapshot.env.map(e => e.name).sort()).toEqual(['BAZ', 'FOO']);
    const foo = snapshot.env.find(e => e.name === 'FOO');
    expect(foo).toEqual({ name: 'FOO', inExample: true, inEnv: true });
    expect(JSON.stringify(snapshot)).not.toContain('super-secret-value');

    expect(snapshot.scripts.map(s => s.name).sort()).toEqual(['lint', 'test']);

    const registry = snapshot.registries.find(r => r.kind === 'skill-registry');
    expect(registry?.entries).toBe(2);
    expect(registry?.stale).toBe(true); // indexed 2 vs 1 scanned

    expect(snapshot.health.docs.agentsMd).toBe(true);
    expect(snapshot.health.ci.workflows).toEqual(['ci.yml']);
    expect(snapshot.health.ci.husky).toBe(false);
    expect(snapshot.health.tests).toEqual({ testScript: true, lintScript: true, typesScript: false });

    expect(snapshot.catalog.models).toHaveLength(1); // shared store (seeded by tests/setup-catalog.ts)
    expect(snapshot.meta.manifest).toBe(false);
  });

  test('minimal harness scans without optional groups', async () => {
    const { snapshot, error } = await scanHarness(join(FIXTURES, 'minimal-harness'));
    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.commands).toHaveLength(0);
    expect(snapshot.health.docs.readme).toBe(false);
    expect(snapshot.registries).toHaveLength(0);
  });

  test('broken harness degrades to warnings, never crashes', async () => {
    const { snapshot, error } = await scanHarness(join(FIXTURES, 'broken-harness'));
    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.skills[0].tier).toBe('T1');
    expect(snapshot.meta.warnings.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.agents.find(a => a.isMain)).toBeUndefined();
  });

  test('manifest overrides conventional skill path', async () => {
    const { snapshot, error } = await scanHarness(join(FIXTURES, 'manifest-harness'));
    expect(error).toBeNull();
    if (!snapshot) { throw new Error('snapshot missing'); }
    expect(snapshot.meta.manifest).toBe(true);
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.skills[0].name).toBe('greeter');
    expect(snapshot.skills[0].path).toBe('custom-skills/greeter/SKILL.md');
  });

  test('nonexistent root errors without throwing', async () => {
    const { snapshot, error } = await scanHarness(join(FIXTURES, 'does-not-exist'));
    expect(snapshot).toBeNull();
    expect(error).toContain('does not exist');
  });

  test('empty harness is rejected as empty scan', async () => {
    const { snapshot, error } = await scanHarness(join(FIXTURES, 'empty-harness'));
    expect(snapshot).toBeNull();
    expect(error).toContain('empty scan');
  });
});
