import type { ApiBody } from './actions/types.ts';

declare global {
  interface Window {
    /** Injected by the serve route (absent in file:// static builds). */
    __HM_SERVE__?: boolean
    __HM_ROOT__?: string
  }
}

export const isServeMode = typeof window !== 'undefined' && window.__HM_SERVE__ === true;

export const serveRoot = typeof window !== 'undefined' ? (window.__HM_ROOT__ ?? '') : '';

/** Fetch helper — always parses the JSON ApiBody (server answers JSON even on 4xx/5xx). */
export async function apiRequest<T = ApiBody>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
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
