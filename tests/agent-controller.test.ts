import type { FetchHandler } from '../src/online/relay-client.ts';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createAgentController } from '../src/agent/controller.ts';

const CODE = 'ABCDEFGHJKMNPQRSTVWXYZ2345';

interface Harness {
  controller: ReturnType<typeof createAgentController>
  recentsFile: string
  root: string
  bound: string[]
}

function build(overrides: Parameters<typeof createAgentController>[0] = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'hm-agent-'));
  const recentsFile = join(root, 'recents.json');
  const bound: string[] = [];
  const controller = createAgentController({
    createAppFactory: (rootAbs) => {
      bound.push(rootAbs);
      const handler: FetchHandler = async () => new Response(`dashboard:${rootAbs}`, { status: 200 });
      return handler;
    },
    pickFolder: async () => null,
    recentsFile,
    ...overrides,
  });
  return { controller, recentsFile, root, bound };
}

function cleanup(harness: Harness): void {
  rmSync(harness.root, { recursive: true, force: true });
}

async function get(controller: ReturnType<typeof createAgentController>, path: string): Promise<Response> {
  return controller.handler(new Request(`http://engine.local${path}`));
}

async function post(controller: ReturnType<typeof createAgentController>, path: string, body?: unknown): Promise<Response> {
  return controller.handler(new Request(`http://engine.local${path}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

describe('agent routes — status', () => {
  test('unbound → picker with null root', async () => {
    const harness = build();
    try {
      const response = await get(harness.controller, '/api/agent/status');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ state: 'picker', root: null });
    }
    finally { cleanup(harness); }
  });

  test('bound → running with the root; wrong method falls through', async () => {
    const harness = build();
    try {
      const bound = harness.controller.bindRoot(harness.root);
      expect(bound).toEqual({ ok: true });
      const response = await get(harness.controller, '/api/agent/status');
      expect(await response.json()).toEqual({ state: 'running', root: harness.root });
      // POST /api/agent/status is not a route → delegates to the dashboard handler
      const wrongMethod = await post(harness.controller, '/api/agent/status');
      expect(await wrongMethod.text()).toBe(`dashboard:${harness.root}`);
    }
    finally { cleanup(harness); }
  });
});

describe('agent routes — recents', () => {
  test('empty file → []; after bind → MRU front', async () => {
    const harness = build();
    try {
      expect(await (await get(harness.controller, '/api/agent/recents')).json()).toEqual([]);
      harness.controller.bindRoot(harness.root);
      const entries = await (await get(harness.controller, '/api/agent/recents')).json() as Array<{ path: string }>;
      expect(entries.map(entry => entry.path)).toEqual([harness.root]);
    }
    finally { cleanup(harness); }
  });
});

describe('agent routes — root binding', () => {
  test('happy path → running, dashboard delegated, recents updated', async () => {
    const harness = build();
    try {
      writeFileSync(harness.recentsFile, JSON.stringify([{ path: '/tmp/old-root', lastUsed: 1 }]));
      const response = await post(harness.controller, '/api/agent/root', { root: harness.root });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, state: 'running', root: harness.root });
      expect(harness.controller.getState()).toBe('running');
      expect(harness.controller.getRoot()).toBe(harness.root);
      expect(harness.bound).toEqual([harness.root]);

      const saved = JSON.parse(readFileSync(harness.recentsFile, 'utf8')) as Array<{ path: string }>;
      expect(saved.map(entry => entry.path)).toEqual([harness.root, '/tmp/old-root']);

      const delegated = await get(harness.controller, '/api/snapshot');
      expect(await delegated.text()).toBe(`dashboard:${harness.root}`);
    }
    finally { cleanup(harness); }
  });

  test('rebind while running swaps the handler in place (spec §3.9)', async () => {
    const harness = build();
    try {
      harness.controller.bindRoot(harness.root);
      const second = mkdtempSync(join(tmpdir(), 'hm-agent-2-'));
      try {
        const response = await post(harness.controller, '/api/agent/root', { root: second });
        expect(response.status).toBe(200);
        expect(harness.bound).toEqual([harness.root, second]);
        const delegated = await get(harness.controller, '/api/snapshot');
        expect(await delegated.text()).toBe(`dashboard:${second}`);
      }
      finally { rmSync(second, { recursive: true, force: true }); }
    }
    finally { cleanup(harness); }
  });

  test('relative path → 400, no bind, recents untouched', async () => {
    const harness = build();
    try {
      const response = await post(harness.controller, '/api/agent/root', { root: 'some/relative/path' });
      expect(response.status).toBe(400);
      const body = await response.json() as { ok: boolean, detail: string };
      expect(body.ok).toBe(false);
      expect(body.detail).toContain('absoluta');
      expect(harness.bound).toEqual([]);
      expect(harness.controller.getState()).toBe('picker');
      expect(existsSync(harness.recentsFile)).toBe(false);
    }
    finally { cleanup(harness); }
  });

  test('missing absolute path → 400 "no existe", no bind', async () => {
    const harness = build();
    try {
      const response = await post(harness.controller, '/api/agent/root', { root: join(tmpdir(), 'hm-never-existed-42') });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { detail: string }).detail).toContain('no existe');
      expect(harness.bound).toEqual([]);
    }
    finally { cleanup(harness); }
  });

  test('file-not-a-directory → 400, recents never written', async () => {
    const harness = build();
    try {
      const fileOnly = join(harness.root, 'not-a-dir.txt');
      writeFileSync(fileOnly, 'x');
      const response = await post(harness.controller, '/api/agent/root', { root: fileOnly });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { detail: string }).detail).toContain('no es un directorio');
      expect(existsSync(harness.recentsFile)).toBe(false);
    }
    finally { cleanup(harness); }
  });

  test('invalid JSON body → 400; body without root → 400', async () => {
    const harness = build();
    try {
      const malformed = await harness.controller.handler(new Request('http://engine.local/api/agent/root', { method: 'POST', body: 'not-json' }));
      expect(malformed.status).toBe(400);
      expect(((await malformed.json()) as { detail: string }).detail).toContain('JSON');

      const missing = await post(harness.controller, '/api/agent/root', {});
      expect(missing.status).toBe(400);
      expect(((await missing.json()) as { detail: string }).detail).toContain('Falta la ruta');
    }
    finally { cleanup(harness); }
  });

  test('recents persistence failure never fails a successful bind', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hm-agent-'));
    try {
      const bound: string[] = [];
      const controller = createAgentController({
        createAppFactory: (rootAbs) => { bound.push(rootAbs); return async () => new Response('dashboard'); },
        recentsFile: root, // a DIRECTORY — every save fails
      });
      const response = await post(controller, '/api/agent/root', { root });
      expect(response.status).toBe(200);
      expect(bound).toEqual([root]);
    }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('agent routes — browse', () => {
  test('dialog path returned; browse NEVER binds', async () => {
    const harness = build({ pickFolder: async () => '/picked/harness' });
    try {
      const response = await post(harness.controller, '/api/agent/browse');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ path: '/picked/harness' });
      expect(harness.controller.getState()).toBe('picker');
      expect(harness.bound).toEqual([]);
    }
    finally { cleanup(harness); }
  });

  test('user cancelled → { path: null }', async () => {
    const harness = build({ pickFolder: async () => null });
    try {
      const response = await post(harness.controller, '/api/agent/browse');
      expect(await response.json()).toEqual({ path: null });
    }
    finally { cleanup(harness); }
  });

  test('browse_unsupported propagates with its stable code (manual-path fallback)', async () => {
    const harness = build({
      pickFolder: async () => {
        const error = new Error('diálogo de carpetas no soportado en linux') as Error & { code: 'browse_unsupported' };
        error.code = 'browse_unsupported';
        throw error;
      },
    });
    try {
      const response = await post(harness.controller, '/api/agent/browse');
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'diálogo de carpetas no soportado en linux', code: 'browse_unsupported' });
    }
    finally { cleanup(harness); }
  });
});

describe('routing order', () => {
  test('unbound unknown path → 404 no_root', async () => {
    const harness = build();
    try {
      const response = await get(harness.controller, '/api/snapshot');
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'no_root' });
    }
    finally { cleanup(harness); }
  });

  test('agent routes win over the bound dashboard handler', async () => {
    const harness = build();
    try {
      harness.controller.bindRoot(harness.root);
      const status = await get(harness.controller, '/api/agent/status');
      const body = await status.json() as { state: string };
      expect(body.state).toBe('running'); // NOT the fake dashboard response
      const snapshot = await get(harness.controller, '/api/agent/recents');
      expect(Array.isArray(await snapshot.json())).toBe(true);
    }
    finally { cleanup(harness); }
  });
});

describe('bootstrapping', () => {
  test('CODE fixture is a valid 26-char session code', () => {
    expect(/^[A-Z2-7]{26}$/.test(CODE)).toBe(true);
  });
});
