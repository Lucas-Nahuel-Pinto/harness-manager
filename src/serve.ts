import type { ApiBody } from './actions/types.ts';

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

/** Static build opened from disk (file://) — no engine, no launcher. */
export const isFileMode = typeof window !== 'undefined' && !isServeMode && !isLauncherMode;

export const serveRoot = typeof window !== 'undefined' ? (window.__HM_ROOT__ ?? '') : '';

/**
 * Engine base URL for API calls: '' = same origin (direct serve mode),
 * absolute = engine on another port (launcher mode), null = engine stopped.
 */
let engineBase: string | null = isServeMode ? '' : null;

export function setEngineBase(base: string | null): void {
  engineBase = base;
}

/** True when an engine is reachable — gates every action (toggle, run, model, open, rescan). */
export function actionsEnabled(): boolean {
  return engineBase !== null;
}

export function actionsHint(): string {
  return actionsEnabled() ? '' : 'Servidor detenido — usá "Iniciar servidor" en la barra superior';
}

/** Fetch helper — always parses the JSON ApiBody (server answers JSON even on 4xx/5xx). */
export async function apiRequest<T = ApiBody>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${engineBase ?? ''}${path}`, init);
  try {
    return await response.json() as T;
  }
  catch {
    throw new Error(`respuesta no JSON (${response.status} ${response.statusText})`);
  }
}

export async function apiGet<T = ApiBody>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export async function apiPost<T = ApiBody>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
