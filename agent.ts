/**
 * HEADLESS AGENT — the local side of the web picker (spec §2).
 *
 * One process, no window, no loopback port: it joins the relay as the `engine`
 * member immediately and serves the agent routes (recents / browse / root) plus
 * the bound dashboard over the existing E2E-encrypted frames.
 *
 * Two flows, one room (spec §3.2):
 *   site-generated — `bun agent.ts <CODE>` (the website showed this command)
 *   agent-generated — `bun agent.ts` → generates a code and prints the pairing URL
 */

import { parseAgentArgv } from './src/agent/args.ts';
import { createAgentController } from './src/agent/controller.ts';
import { generateCode } from './src/online/pairing.ts';
import { startRelayClient } from './src/online/relay-client.ts';

const args = parseAgentArgv(process.argv.slice(2));
if (args.invalidCode) {
  console.error('Código de emparejamiento inválido — usá el código que muestra la web, o borrá el argumento para generar uno nuevo.');
  process.exit(1);
}

const generated = args.code === null;
const code = args.code ?? generateCode();

const controller = createAgentController();
const relayClient = startRelayClient({
  relayUrl: args.relayUrl,
  code,
  rootAbs: controller.getRoot() ?? '(agente — sin harness seleccionado)',
  fetchHandler: controller.handler,
  onConnect: (url) => {
    if (generated) { console.log(`Online: ${url}`); }
    else { console.log('agente conectado — abrí (o recargá) la app para elegir el harness'); }
  },
  onDisconnect: () => { console.log('relay perdido — reintentando…'); },
  log: (message) => { console.log(message); },
});

console.log(`harness-manager agente en pie · relay: ${args.relayUrl} · detener: Ctrl+C`);

process.on('exit', () => { void relayClient.close(); });
