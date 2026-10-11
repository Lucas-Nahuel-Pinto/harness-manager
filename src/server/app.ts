import type { ApiBody } from '../actions/types.ts';
import { resolve } from 'node:path';
import { dispatchAction } from '../actions/index.ts';
import { runScript } from '../actions/script-run.ts';
import { scanHarness } from '../scan/index.ts';
import { corsPreflight, withCors } from './cors.ts';

function json(status: number, body: ApiBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Pure request handler (no sockets) — tests call it with `new Request('http://127.0.0.1/...')`.
 * API-only since spec 2026-10-11: routes are GET /api/snapshot · POST /api/action ·
 * POST /api/run · OPTIONS → 204 · anything else → 404 (the UI lives on the hosted site).
 * CORS: kept for the local dev proxy (`bun run dev` → engine on another port).
 */
export function createApp(rootInput: string): (req: Request) => Response | Promise<Response> {
  const rootAbs = resolve(rootInput);

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') { return corsPreflight(); }
    return withCors(await route(req, rootAbs));
  };
}

async function route(req: Request, rootAbs: string): Promise<Response> {
  const { pathname } = new URL(req.url);

  if (pathname === '/api/snapshot' && req.method === 'GET') {
    const { snapshot, error } = await scanHarness(rootAbs);
    if (!snapshot) { return json(500, { ok: false, error: 'scan_failed', detail: error ?? 'scan failed' }); }
    return json(200, { ok: true, snapshot });
  }

  if (pathname === '/api/action' && req.method === 'POST') {
    let payload: unknown;
    try {
      payload = await req.json();
    }
    catch {
      return json(400, { ok: false, error: 'bad_json', detail: 'el body no es JSON válido' });
    }
    const { status, body } = await dispatchAction(rootAbs, payload);
    return json(status, body);
  }

  if (pathname === '/api/run' && req.method === 'POST') {
    let payload: unknown;
    try {
      payload = await req.json();
    }
    catch {
      return json(400, { ok: false, error: 'bad_json', detail: 'el body no es JSON válido' });
    }
    const name = (payload && typeof payload === 'object' ? (payload as Record<string, unknown>).name : undefined);
    const { status, body } = await runScript(rootAbs, name);
    return json(status, body);
  }

  return json(404, { ok: false, error: 'not_found', detail: `${req.method} ${pathname}` });
}
