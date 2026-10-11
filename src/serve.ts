/* eslint-disable import/no-mutable-exports -- enableOnlineMode() flips isOnlineMode before the first render; importers read ESM live bindings. */
import type { ApiBody } from './actions/types.ts';
import type { Transport } from './online/transport.ts';
import { FetchTransport } from './online/transport.ts';

/** Set by the online boot — drives badge copy; false under the local dev proxy. */
export let isOnlineMode = false;

/** Local path: same-origin fetch (vite dev proxy forwards /api to the engine — see vite.config.ts). */
const fetchTransport = new FetchTransport(() => '');
let activeTransport: Transport | null = null; // null → the historical fetch path (byte-identical)

/**
 * Online boot swaps the single API seam for the E2E WebSocket transport and flips the mode flag
 * in one call, so the first render already sees a consistent online state.
 */
export function enableOnlineMode(transport: Transport): void {
  activeTransport = transport;
  isOnlineMode = true;
}

function currentTransport(): Transport {
  return activeTransport ?? fetchTransport;
}

/** True when an engine is reachable — gates every action (toggle, run, model, open, rescan). */
export function actionsEnabled(): boolean {
  return activeTransport ? activeTransport.status === 'online' : true;
}

export function actionsHint(): string {
  return actionsEnabled() ? '' : 'Sin conexión con el motor — reintentando…';
}

export async function apiGet<T = ApiBody>(path: string): Promise<T> {
  return currentTransport().api<T>('GET', path);
}

export async function apiPost<T = ApiBody>(path: string, body: unknown): Promise<T> {
  return currentTransport().api<T>('POST', path, body);
}
