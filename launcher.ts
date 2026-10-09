import { resolve } from 'node:path';
import { createLauncher, killEngineProcess, spawnEngineProcess } from './src/launcher/app.ts';
import { parseOnlineArgv } from './src/online/relay-client.ts';

function argValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(flag);
  return index !== -1 ? argv[index + 1] : undefined;
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      Bun.spawnSync(['cmd', '/c', 'start', '', url], { stdout: 'ignore', stderr: 'ignore' });
    }
    else if (process.platform === 'darwin') {
      Bun.spawnSync(['open', url], { stdout: 'ignore', stderr: 'ignore' });
    }
    else {
      Bun.spawnSync(['xdg-open', url], { stdout: 'ignore', stderr: 'ignore' });
    }
  }
  catch { /* best effort — the printed URL always works */ }
}

const rootAbs = resolve(argValue('--root') ?? process.cwd());
const portRaw = argValue('--port') ?? process.env.HM_LAUNCHER_PORT ?? '7397';
const port = Number(portRaw);
const repoRoot = resolve(import.meta.dir);
const engineOnlineArgs = parseOnlineArgv(process.argv.slice(2));

// Keep a handle on the engine so an abrupt launcher exit does not orphan it.
let activeEngine: ReturnType<typeof spawnEngineProcess> | null = null;

const server = Bun.serve({
  hostname: '127.0.0.1', // loopback only — never 0.0.0.0
  port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 7397,
  fetch: createLauncher(rootAbs, {
    spawnEngine: () => {
      activeEngine = spawnEngineProcess(repoRoot, rootAbs, engineOnlineArgs);
      return activeEngine;
    },
    killEngine: async (handle) => {
      try {
        await killEngineProcess(handle);
      }
      finally {
        if (activeEngine === handle) { activeEngine = null; }
      }
    },
  }),
});

process.on('exit', () => {
  const handle = activeEngine;
  if (handle?.isAlive?.()) {
    if (process.platform === 'win32') {
      Bun.spawnSync(['taskkill', '/pid', String(handle.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' });
    }
    else {
      try { handle.proc?.kill('SIGKILL'); }
      catch { /* already dead */ }
    }
  }
});

const url = `http://127.0.0.1:${server.port}/`;
console.log(`Harness Manager (launcher) en ${url} · root: ${rootAbs}`);
if (process.env.HM_NO_OPEN !== '1') { openBrowser(url); }
