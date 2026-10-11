import { resolve } from 'node:path';
import { createApp } from './src/server/app.ts';

function argValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(flag);
  return index !== -1 ? argv[index + 1] : undefined;
}

// Diagnostic/dev entry (spec 2026-10-11 §3.7): API-only loopback, NO UI, NO relay.
// The online path is owned exclusively by `agent.ts`.
const rootAbs = resolve(argValue('--root') ?? process.cwd());
const portRaw = argValue('--port') ?? process.env.HM_PORT ?? '0';
const port = Number(portRaw);
const fetchHandler = createApp(rootAbs);
const server = Bun.serve({
  hostname: '127.0.0.1', // loopback only — never 0.0.0.0
  port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 0,
  fetch: fetchHandler,
});

console.log(`Harness Manager sirviendo en http://127.0.0.1:${server.port} · root: ${rootAbs}`);
