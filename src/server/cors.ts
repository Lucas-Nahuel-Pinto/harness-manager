/** Loopback-only CORS — the launcher-origin page calls the engine cross-port (and file:// probes the launcher). */
export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

/** Preflight answer (any OPTIONS request) — 204, no body. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Return a copy of `response` with the CORS headers attached. */
export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) { headers.set(key, value); }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
