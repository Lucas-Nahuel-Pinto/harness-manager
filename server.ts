import { resolve } from 'node:path';
import { generateCode } from './src/online/pairing.ts';
import { parseOnlineFlag, startRelayClient } from './src/online/relay-client.ts';
import { refreshModelCatalogIfAvailable } from './src/scan/misc.ts';
import { createApp } from './src/server/app.ts';

function argValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(flag);
  return index !== -1 ? argv[index + 1] : undefined;
}

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

const relayUrl = parseOnlineFlag(process.argv.slice(2));
if (relayUrl) {
  const code = generateCode();
  const relayClient = startRelayClient({
    relayUrl,
    code,
    rootAbs,
    fetchHandler,
    onConnect: (url) => { console.log(`Online: ${url}`); },
    onDisconnect: () => { console.log('relay perdido — reintentando…'); },
    log: (message) => { console.log(message); },
  });
  process.on('exit', () => { void relayClient.close(); });
}

// Fire-and-forget model catalog refresh — async, never blocks the event loop.
void refreshModelCatalogIfAvailable(rootAbs).catch(() => { /* best effort */ });
