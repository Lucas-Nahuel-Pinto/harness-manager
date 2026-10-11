import type { ControllerOptions, EngineHandle } from '../src/desktop/controller.ts';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createController, createKillEngine, engineArgs } from '../src/desktop/controller.ts';
import { createOnlineLineFilter } from '../src/desktop/online-lines.ts';

const PAIRING_URL = 'https://demo.pages.dev/#c=ABCDEFGHJKMNPQRSTVWXYZ234567';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface FakeEngine {
  handle: EngineHandle
  exit: ReturnType<typeof deferred<{ exitCode: number | null }>>
  emit: (line: string) => void
  killCalls: () => number
}

/** Fake engine handle: line emission + kill resolves exit (graceful path). */
function fakeEngine(): FakeEngine {
  const exit = deferred<{ exitCode: number | null }>();
  let lineCb: ((line: string) => void) | null = null;
  let kills = 0;
  const handle: EngineHandle = {
    onLine: (cb) => { lineCb = cb; },
    exit: exit.promise,
    kill: async () => {
      kills += 1;
      exit.resolve({ exitCode: 0 });
      return 'graceful';
    },
  };
  return { handle, exit, emit: line => lineCb?.(line), killCalls: () => kills };
}

interface Harness {
  controller: ReturnType<typeof createController>
  recentsFile: string
  opens: string[]
  root: string
  spawnCount: () => number
}

function build(engine: FakeEngine, overrides: Partial<ControllerOptions> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'hm-desktop-'));
  const recentsFile = join(root, 'recents.json');
  const opens: string[] = [];
  let spawns = 0;
  const controller = createController({
    spawnEngine: () => { spawns += 1; return engine.handle; },
    openUrl: (url) => { opens.push(url); },
    recentsFile,
    ...overrides,
  });
  return { controller, recentsFile, opens, root, spawnCount: () => spawns };
}

function cleanup(harness: Harness): void {
  rmSync(harness.root, { recursive: true, force: true });
}

async function settle(): Promise<void> {
  await new Promise(r => setTimeout(r, 5));
}

describe('engineArgs (always-online spawn argv)', () => {
  test('includes --root, --port 0, and --online', () => {
    const args = engineArgs('X');
    expect(args).toEqual(['bun', 'server.ts', '--root', 'X', '--port', '0', '--online']);
    expect(args).toContain('--root');
    expect(args[args.indexOf('--root') + 1]).toBe('X');
    expect(args[args.indexOf('--port') + 1]).toBe('0');
    expect(args).toContain('--online');
  });
});

describe('pickRoot', () => {
  test('happy path → running, pairing URL captured, recents MRU front, openUrl called', async () => {
    const engine = fakeEngine();
    const harness = build(engine);
    try {
      writeFileSync(harness.recentsFile, JSON.stringify([{ path: '/tmp/old-root', lastUsed: 1 }]));
      const pending = harness.controller.pickRoot(harness.root);
      engine.emit('Harness Manager sirviendo en http://127.0.0.1:41000\n');
      engine.emit(`Online: ${PAIRING_URL}\n`);
      const result = await pending;
      expect(result).toEqual({ ok: true, pairingUrl: PAIRING_URL });
      expect(harness.controller.getState()).toBe('running');
      expect(harness.spawnCount()).toBe(1);

      const saved = JSON.parse(readFileSync(harness.recentsFile, 'utf8')) as Array<{ path: string }>;
      expect(saved.map(entry => entry.path)).toEqual([harness.root, '/tmp/old-root']);

      expect(harness.opens).toEqual([PAIRING_URL]); // auto-open of the hosted app (spec §2)
    }
    finally { cleanup(harness); }
  });

  test('hmNoOpen → openUrl NOT called, URL still returned', async () => {
    const engine = fakeEngine();
    const harness = build(engine, { hmNoOpen: true });
    try {
      const pending = harness.controller.pickRoot(harness.root);
      engine.emit(`Online: ${PAIRING_URL}`);
      const result = await pending;
      expect(result).toEqual({ ok: true, pairingUrl: PAIRING_URL });
      expect(harness.opens).toEqual([]);
    }
    finally { cleanup(harness); }
  });

  test('only the FIRST Online: line wins (reconnect re-prints are ignored)', async () => {
    const engine = fakeEngine();
    const harness = build(engine);
    try {
      const pending = harness.controller.pickRoot(harness.root);
      engine.emit(`Online: ${PAIRING_URL}`);
      engine.emit('Online: https://other.pages.dev/#c=ZZZZZZZZZZZZZZZZZZZZZZZZZZ');
      const result = await pending;
      expect(result).toEqual({ ok: true, pairingUrl: PAIRING_URL });
    }
    finally { cleanup(harness); }
  });

  test('relative path → { ok: false }, spawn NOT called, recents untouched, state stays picker', async () => {
    const engine = fakeEngine();
    const harness = build(engine);
    try {
      const result = await harness.controller.pickRoot('some/relative/path');
      expect(result.ok).toBe(false);
      if (!result.ok) { expect(result.detail).toContain('absoluta'); }
      expect(harness.spawnCount()).toBe(0);
      expect(harness.controller.getState()).toBe('picker');
      expect(existsSync(harness.recentsFile)).toBe(false); // never written by a failed pick
    }
    finally { cleanup(harness); }
  });

  test('missing absolute path → { ok: false }, spawn NOT called', async () => {
    const engine = fakeEngine();
    const harness = build(engine);
    try {
      const result = await harness.controller.pickRoot(join(tmpdir(), 'hm-never-existed-42'));
      expect(result.ok).toBe(false);
      if (!result.ok) { expect(result.detail).toContain('no existe'); }
      expect(harness.spawnCount()).toBe(0);
      expect(harness.controller.getState()).toBe('picker');
    }
    finally { cleanup(harness); }
  });

  test('file-not-a-directory → { ok: false }, spawn NOT called, recents file never created', async () => {
    const engine = fakeEngine();
    const harness = build(engine);
    try {
      const fileOnly = join(harness.root, 'not-a-dir.txt');
      writeFileSync(fileOnly, 'x');
      const result = await harness.controller.pickRoot(fileOnly);
      expect(result.ok).toBe(false);
      if (!result.ok) { expect(result.detail).toContain('no es un directorio'); }
      expect(harness.spawnCount()).toBe(0);
      expect(harness.controller.getState()).toBe('picker');
      expect(existsSync(harness.recentsFile)).toBe(false);
    }
    finally { cleanup(harness); }
  });

  test('engine exits before any Online: line → error, recents NOT written', async () => {
    const engine = fakeEngine();
    const harness = build(engine);
    try {
      const pending = harness.controller.pickRoot(harness.root);
      engine.exit.resolve({ exitCode: 1 });
      const result = await pending;
      expect(result.ok).toBe(false);
      if (!result.ok) { expect(result.detail).toContain('código 1'); }
      expect(harness.controller.getState()).toBe('error');
      expect(existsSync(harness.recentsFile)).toBe(false);
      expect(harness.opens).toEqual([]);
    }
    finally { cleanup(harness); }
  });

  test('spawn throws → error state, recents NOT written', async () => {
    const engine = fakeEngine();
    const harness = build(engine, {
      spawnEngine: () => { throw new Error('bun no encontrado'); },
    });
    try {
      const result = await harness.controller.pickRoot(harness.root);
      expect(result).toEqual({ ok: false, detail: 'bun no encontrado' });
      expect(harness.controller.getState()).toBe('error');
      expect(existsSync(harness.recentsFile)).toBe(false);
    }
    finally { cleanup(harness); }
  });
});

describe('openPairing', () => {
  test('honors HM_NO_OPEN via openPairing directly', () => {
    const engine = fakeEngine();
    const harness = build(engine, { hmNoOpen: true });
    try {
      harness.controller.openPairing(PAIRING_URL);
      expect(harness.opens).toEqual([]);
    }
    finally { cleanup(harness); }
  });

  test('calls openUrl with the pairing URL', () => {
    const engine = fakeEngine();
    const harness = build(engine);
    try {
      harness.controller.openPairing(PAIRING_URL);
      expect(harness.opens).toEqual([PAIRING_URL]);
    }
    finally { cleanup(harness); }
  });
});

describe('detener (intentional stop)', () => {
  test('graceful path → state picker, no crash notification', async () => {
    const engine = fakeEngine();
    const harness = build(engine);
    try {
      const pending = harness.controller.pickRoot(harness.root);
      engine.emit(`Online: ${PAIRING_URL}`);
      await pending;

      const seen: string[] = [];
      harness.controller.subscribe(state => seen.push(state));
      await harness.controller.detener();
      expect(harness.controller.getState()).toBe('picker');
      expect(engine.killCalls()).toBe(1);
      await settle();
      expect(seen).not.toContain('crashed'); // intentional stop ≠ crash (spec §3.4)
    }
    finally { cleanup(harness); }
  });

  test('detener without a running engine is a no-op that keeps picker', async () => {
    const engine = fakeEngine();
    const harness = build(engine);
    try {
      await harness.controller.detener();
      expect(harness.controller.getState()).toBe('picker');
      expect(engine.killCalls()).toBe(0);
    }
    finally { cleanup(harness); }
  });
});

describe('engine crash while running', () => {
  test('exit after running → crashed via subscribe', async () => {
    const engine = fakeEngine();
    const harness = build(engine);
    try {
      const pending = harness.controller.pickRoot(harness.root);
      engine.emit(`Online: ${PAIRING_URL}`);
      await pending;

      const seen: string[] = [];
      harness.controller.subscribe(state => seen.push(state));
      engine.exit.resolve({ exitCode: 1 });
      await settle();
      expect(harness.controller.getState()).toBe('crashed');
      expect(seen).toEqual(['crashed']);
    }
    finally { cleanup(harness); }
  });
});

describe('createKillEngine (graceful → 5s escalation, ported from launcher)', () => {
  test('graceful kill resolves exit → outcome graceful, no force', async () => {
    const exit = deferred<{ exitCode: number | null }>();
    const modes: string[] = [];
    const kill = createKillEngine({
      kill: async (mode) => {
        modes.push(mode);
        if (mode === 'graceful') { exit.resolve({ exitCode: 0 }); }
      },
      exit: exit.promise,
    });
    expect(await kill()).toBe('graceful');
    expect(modes).toEqual(['graceful']);
  });

  test('graceful kill ignored → force after timeout, outcome escalated', async () => {
    const exit = deferred<{ exitCode: number | null }>();
    const modes: string[] = [];
    const kill = createKillEngine({
      kill: async (mode) => {
        modes.push(mode);
        if (mode === 'force') { exit.resolve({ exitCode: 9 }); }
      },
      exit: exit.promise,
    }, 20);
    expect(await kill()).toBe('escalated');
    expect(modes).toEqual(['graceful', 'force']);
  });

  test('dead process short-circuits → already-dead, no kill call', async () => {
    const exit = deferred<{ exitCode: number | null }>();
    let kills = 0;
    const kill = createKillEngine({
      kill: async () => { kills += 1; },
      exit: exit.promise,
      isAlive: () => false,
    });
    expect(await kill()).toBe('already-dead');
    expect(kills).toBe(0);
  });
});

describe('createOnlineLineFilter (moved from launcher)', () => {
  test('extracts complete Online: lines and passes other stdout through', () => {
    const filter = createOnlineLineFilter();
    expect(filter('Harness Manager sirviendo en http://127.0.0.1:41000\n')).toEqual([]);
    expect(filter('Online: https://demo.pages.dev/#c=ABCDEFGHJKMNPQRSTVWXYZ2345\n'))
      .toEqual(['Online: https://demo.pages.dev/#c=ABCDEFGHJKMNPQRSTVWXYZ2345']);
  });

  test('buffers a line split across chunks', () => {
    const filter = createOnlineLineFilter();
    expect(filter('Online: https://demo.pages.dev/#c=')).toEqual([]);
    expect(filter('ABCD\n')).toEqual(['Online: https://demo.pages.dev/#c=ABCD']);
  });

  test('handles CRLF and multiple Online lines (reconnect re-prints)', () => {
    const filter = createOnlineLineFilter();
    expect(filter('x\r\nOnline: a\r\nOnline: b\r\n')).toEqual(['Online: a', 'Online: b']);
    expect(filter('otra Online: no')).toEqual([]);
    expect(filter('\n')).toEqual([]);
  });
});
