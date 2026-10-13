import type { ApiBody } from '../src/actions/types.ts';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'bun:test';
import { createApp } from '../src/server/app.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mini-harness');
const FIXTURE_MCP = join(FIXTURE, 'opencode.jsonc');
const MAIN_ID = 'agent:opencode.jsonc';
const HELPER_ID = 'agent:.opencode/agents/helper.md';

type App = ReturnType<typeof createApp>;

let root: string;
let app: App;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hm-api-'));
  cpSync(FIXTURE, root, { recursive: true });
  app = createApp(root);
});

async function request(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(app(new Request(`http://127.0.0.1${path}`, init)));
}

async function jsonPost(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function body(response: Response): Promise<ApiBody> {
  return await response.json() as ApiBody;
}

describe('GET /api/snapshot', () => {
  test('answers a fresh scan of the harness root', async () => {
    const response = await request('/api/snapshot');
    expect(response.status).toBe(200);
    const parsed = await body(response);
    expect(parsed.ok).toBe(true);
    if (!parsed.snapshot) { throw new Error('snapshot missing'); }
    expect(parsed.snapshot.skills).toHaveLength(1);
    expect(parsed.snapshot.mcps).toHaveLength(2);
    expect(parsed.snapshot.meta.root).toBe(root);
  });

  test('unknown /api path → 404', async () => {
    const response = await request('/api/nope');
    expect(response.status).toBe(404);
    expect((await body(response)).error).toBe('not_found');
  });
});

describe('POST /api/action — staged mcp-toggle', () => {
  const payload = { configFile: 'opencode.jsonc', name: 'tavily', enable: false };

  test('stage 1 returns diff + summary WITHOUT touching the file', async () => {
    const configPath = join(root, 'opencode.jsonc');
    const before = readFileSync(configPath, 'utf8');

    const response = await jsonPost('/api/action', { kind: 'mcp-toggle', payload });
    expect(response.status).toBe(200);
    const parsed = await body(response);
    expect(parsed.ok).toBe(true);
    expect(parsed.stage).toBe('confirm');
    expect(parsed.summary).toContain('Deshabilitar');
    expect(parsed.diff).toContain('--- a/opencode.jsonc');
    expect(parsed.diff).toContain('+++ b/opencode.jsonc');
    expect(parsed.diff).toMatch(/^\+ +"enabled": false,?$/m);
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  test('stage 2 applies atomically and returns the new snapshot', async () => {
    const configPath = join(root, 'opencode.jsonc');

    const response = await jsonPost('/api/action', { kind: 'mcp-toggle', payload, confirm: true });
    expect(response.status).toBe(200);
    const parsed = await body(response);
    expect(parsed.ok).toBe(true);
    if (!parsed.snapshot) { throw new Error('snapshot missing'); }

    const applied = readFileSync(configPath, 'utf8');
    expect(applied).toContain('"enabled": false');
    const tavily = parsed.snapshot.mcps.find(mcp => mcp.name === 'tavily');
    expect(tavily?.enabled).toBe(false);
    expect(applied).toContain('Bearer {env:TAVILY_API_KEY}'); // comments/strings intact

    const rescan = await body(await request('/api/snapshot'));
    expect(rescan.snapshot?.mcps.find(mcp => mcp.name === 'tavily')?.enabled).toBe(false);
  });

  test('unknown kind → 400', async () => {
    const response = await jsonPost('/api/action', { kind: 'rm-rf' });
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('unknown_kind');
  });

  test('non-object body → 400 bad_body', async () => {
    const response = await jsonPost('/api/action', 'null');
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('bad_body');
  });

  test('malformed JSON body → 400 bad_json', async () => {
    const response = await jsonPost('/api/action', '{not json');
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('bad_json');
  });
});

describe('POST /api/action — staged mcp-toggle on .mcp.json', () => {
  const payload = { configFile: '.mcp.json', name: 'context7', enable: false };

  test('stage 1 diffs .claude/settings.json and touches nothing', async () => {
    const before = readFileSync(join(root, '.mcp.json'), 'utf8');

    const response = await jsonPost('/api/action', { kind: 'mcp-toggle', payload });
    expect(response.status).toBe(200);
    const parsed = await body(response);
    expect(parsed.ok).toBe(true);
    expect(parsed.stage).toBe('confirm');
    expect(parsed.diff).toContain('--- a/.claude/settings.json');
    expect(parsed.diff).toContain('+++ b/.claude/settings.json');
    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe(before);
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false);
  });

  test('stage 2 creates the settings file (and its directory) and flips the snapshot', async () => {
    rmSync(join(root, '.claude'), { recursive: true, force: true }); // prove the write creates the dir

    const response = await jsonPost('/api/action', { kind: 'mcp-toggle', payload, confirm: true });
    expect(response.status).toBe(200);
    const parsed = await body(response);
    expect(parsed.ok).toBe(true);
    if (!parsed.snapshot) { throw new Error('snapshot missing'); }
    expect(parsed.snapshot.mcps.find(mcp => mcp.name === 'context7')?.enabled).toBe(false);
    expect(parsed.snapshot.mcps.find(mcp => mcp.name === 'tavily')?.enabled).toBe(true); // opencode entry untouched

    const applied = readFileSync(join(root, '.claude', 'settings.json'), 'utf8');
    expect(applied).toContain('"context7"');
  });
});

describe('POST /api/action — staged model-set', () => {
  test('stage 1 diffs, stage 2 rewrites the subagent frontmatter', async () => {
    const helperPath = join(root, '.opencode', 'agents', 'helper.md');
    const before = readFileSync(helperPath, 'utf8');

    const stage1 = await jsonPost('/api/action', {
      kind: 'model-set',
      payload: { agentId: HELPER_ID, model: 'opencode/demo-model' },
    });
    expect(stage1.status).toBe(200);
    const first = await body(stage1);
    expect(first.stage).toBe('confirm');
    expect(first.diff).toContain('--- a/.opencode/agents/helper.md');
    expect(readFileSync(helperPath, 'utf8')).toBe(before);

    const stage2 = await jsonPost('/api/action', {
      kind: 'model-set',
      payload: { agentId: HELPER_ID, model: 'opencode/demo-model' },
      confirm: true,
    });
    expect(stage2.status).toBe(200);
    const second = await body(stage2);
    expect(second.ok).toBe(true);
    if (!second.snapshot) { throw new Error('snapshot missing'); }
    expect(readFileSync(helperPath, 'utf8')).toContain('model: opencode/demo-model');
    const helper = second.snapshot.agents.find(agent => agent.id === HELPER_ID);
    expect(helper?.model).toBe('opencode/demo-model');
    const main = second.snapshot.agents.find(agent => agent.id === MAIN_ID);
    expect(main?.model).toBe('opencode/mimo-v2.6-flash-free'); // untouched
  });

  test('invalid model → 400 without staging', async () => {
    const response = await jsonPost('/api/action', {
      kind: 'model-set',
      payload: { agentId: HELPER_ID, model: 'nope/nope' },
    });
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('invalid_model');
  });
});

describe('open-path guard', () => {
  test('traversal target → 400 path_escape', async () => {
    const response = await jsonPost('/api/action', { kind: 'open-path', target: '../outside.txt' });
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('path_escape');
  });

  test('missing target → 400 bad_body', async () => {
    const response = await jsonPost('/api/action', { kind: 'open-path' });
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('bad_body');
  });
});

describe('POST /api/run', () => {
  function withScripts(scripts: Record<string, string>): void {
    const pkgPath = join(root, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts: Record<string, string> };
    pkg.scripts = { ...pkg.scripts, ...scripts };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  }

  test('script missing from package.json → 400 script_not_found', async () => {
    const response = await jsonPost('/api/run', { name: 'ghost' });
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('script_not_found');
  });

  test('shell-looking name → 400 invalid_script_name', async () => {
    for (const name of ['a/b', 'a\\b', '--flag']) {
      const response = await jsonPost('/api/run', { name });
      expect(response.status).toBe(400);
      expect((await body(response)).error).toBe('invalid_script_name');
    }
  });

  test('successful script → 200 with output and exitCode 0', async () => {
    withScripts({ hello: 'bun --version' });
    const response = await jsonPost('/api/run', { name: 'hello' });
    expect(response.status).toBe(200);
    const parsed = await body(response);
    expect(parsed.ok).toBe(true);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.output?.trim().length ?? 0).toBeGreaterThan(0);
  }, 20_000);

  test('failing script → 200 with ok:false and its exit code', async () => {
    withScripts({ boom: 'bun -e \'process.exit(3)\'' });
    const response = await jsonPost('/api/run', { name: 'boom' });
    expect(response.status).toBe(200);
    const parsed = await body(response);
    expect(parsed.ok).toBe(false);
    expect(parsed.exitCode).toBe(3);
    expect(typeof parsed.output).toBe('string');
  }, 20_000);
});

describe('fixture safety', () => {
  test('the committed mini-harness fixture is never written', async () => {
    const original = readFileSync(FIXTURE_MCP, 'utf8');
    await jsonPost('/api/action', {
      kind: 'mcp-toggle',
      payload: { configFile: 'opencode.jsonc', name: 'tavily', enable: false },
      confirm: true,
    });
    await jsonPost('/api/action', {
      kind: 'model-set',
      payload: { agentId: HELPER_ID, model: 'opencode/demo-model' },
      confirm: true,
    });
    expect(readFileSync(FIXTURE_MCP, 'utf8')).toBe(original);
    expect(readFileSync(join(FIXTURE, '.opencode', 'agents', 'helper.md'), 'utf8')).toContain('deepseek/deepseek-flash');
  });
});
