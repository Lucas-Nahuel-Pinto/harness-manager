/** Agent entry argv: optional positional code (or pairing URL) + `--relay ws…` override. */

import { extractCodeFromInput, RELAY_URL } from '../online/pairing.ts';

export interface AgentArgs {
  /** 26-char session code from argv; null = the agent generates its own (and prints the pairing URL). */
  code: string | null
  /** Relay WS endpoint; defaults to the production relay. */
  relayUrl: string
  /** argv carried an unparseable code/URL — the entry prints usage and exits. */
  invalidCode: boolean
}

/**
 * `bun agent.ts [code|pairing-url] [--relay ws…]` — base32 `[A-Z2-7]` and
 * `ws…` tokens need no shell quoting on any platform. `--relay` may appear
 * before or after the positional code.
 */
export function parseAgentArgv(argv: readonly string[]): AgentArgs {
  let relayUrl = RELAY_URL;
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--relay') {
      const next = argv[index + 1];
      if (next !== undefined && next.startsWith('ws')) {
        relayUrl = next;
        index += 1;
      }
      continue;
    }
    positionals.push(token);
  }
  const raw = positionals[0];
  if (raw === undefined) { return { code: null, relayUrl, invalidCode: false }; }
  const code = extractCodeFromInput(raw);
  return { code, relayUrl, invalidCode: code === null };
}
