import type { ApiBody } from './actions/types.ts';
import type { Transport } from './online/transport.ts';

/**
 * The API seam: the online boot calls `enableOnlineMode(transport)` before the first render.
 * There is no fetch fallback anymore (spec 2026-10-12) — a missing transport is a programming
 * error that degrades to disabled actions, never to a silent local fetch.
 */
let activeTransport: Transport | null = null;

export function enableOnlineMode(transport: Transport): void {
  activeTransport = transport;
}

/** True when the transport is connected — gates every action (toggle, run, model, open, rescan). */
export function actionsEnabled(): boolean {
  return activeTransport?.status === 'online';
}

export function actionsHint(): string {
  return actionsEnabled() ? '' : 'Sin conexión con el motor — reintentando…';
}

export async function apiGet<T = ApiBody>(path: string): Promise<T> {
  const transport = activeTransport;
  if (transport === null) { throw new Error('transporte no inicializado'); }
  return transport.api<T>('GET', path);
}

export async function apiPost<T = ApiBody>(path: string, body: unknown): Promise<T> {
  const transport = activeTransport;
  if (transport === null) { throw new Error('transporte no inicializado'); }
  return transport.api<T>('POST', path, body);
}
