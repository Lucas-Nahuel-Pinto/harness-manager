/* eslint-disable import/no-mutable-exports -- enableOnlineMode() rebinds the mode flags before the first render; importers read ESM live bindings. */
import type { ApiBody } from './actions/types.ts';
import type { Transport } from './online/transport.ts';
import { FetchTransport } from './online/transport.ts';

declare global {
  interface Window {
    /** Injected by the serve route (absent in file:// static builds). */
    __HM_SERVE__?: boolean
    /** Injected by the launcher route (page owned by the launcher, engine on another port). */
    __HM_LAUNCHER__?: boolean
    __HM_ROOT__?: string
  }
}

export const isServeMode = typeof window !== 'undefined' && window.__HM_SERVE__ === true;

export const isLauncherMode = typeof window !== 'undefined' && window.__HM_LAUNCHER__ === true;

/** Static build opened from disk (file://) — no engine, no launcher. Online boot flips it off. */
export let isFileMode = typeof window !== 'undefined' && !isServeMode && !isLauncherMode;

/** Set by the online boot — drives badge/server-control copy; false in every local mode. */
export let isOnlineMode = false;

export const serveRoot = typeof window !== 'undefined' ? (window.__HM_ROOT__ ?? '') : '';

/**
 * Engine base URL for API calls: '' = same origin (direct serve mode),
 * absolute = engine on another port (launcher mode), null = engine stopped.
 */
let engineBase: string | null = isServeMode ? '' : null;

export function setEngineBase(base: string | null): void {
  engineBase = base;
}

const fetchTransport = new FetchTransport(() => engineBase ?? '');
let activeTransport: Transport | null = null; // null → the historical fetch path (byte-identical)

/**
 * Online boot swaps the single API seam for the E2E WebSocket transport and flips the mode flags
 * in one call, so the first render already sees a consistent online state.
 */
export function enableOnlineMode(transport: Transport): void {
  activeTransport = transport;
  isOnlineMode = true;
  isFileMode = false;
}

function currentTransport(): Transport {
  return activeTransport ?? fetchTransport;
}

/** True when an engine is reachable — gates every action (toggle, run, model, open, rescan). */
export function actionsEnabled(): boolean {
  if (activeTransport) { return activeTransport.status === 'online'; }
  return engineBase !== null;
}

export function actionsHint(): string {
  if (activeTransport) { return activeTransport.status === 'online' ? '' : 'Sin conexión con el motor — reintentando…'; }
  return actionsEnabled() ? '' : 'Servidor detenido — usá "Iniciar servidor" en la barra superior';
}

export async function apiGet<T = ApiBody>(path: string): Promise<T> {
  return currentTransport().api<T>('GET', path);
}

export async function apiPost<T = ApiBody>(path: string, body: unknown): Promise<T> {
  return currentTransport().api<T>('POST', path, body);
}
