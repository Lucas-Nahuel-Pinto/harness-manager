import type { ApiBody } from '../actions/types.ts';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dispatchAction } from '../actions/index.ts';
import { runScript } from '../actions/script-run.ts';
import { scanHarness } from '../scan/index.ts';

const DIST_INDEX = resolve(import.meta.dir, '..', '..', 'dist', 'index.html');

function json(status: number, body: ApiBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Inject serve-mode flags before `</head>` so the built UI knows it is NOT file:// mode. */
export function injectServeFlags(html: string, rootAbs: string): string {
  const rootJson = JSON.stringify(rootAbs).replace(/</g, '\\u003c');
  const tag = `<script>window.__HM_SERVE__=true;window.__HM_ROOT__=${rootJson};</script>`;
  if (html.includes('</head>')) { return html.replace('</head>', `${tag}</head>`); }
  return `${tag}${html}`;
}

/**
 * Pure request handler (no sockets) — tests call it with `new Request('http://127.0.0.1/...')`.
 * Routes: GET /api/snapshot · POST /api/action · POST /api/run · everything else → built dist.
 */
export function createApp(rootInput: string): (req: Request) => Response | Promise<Response> {
  const rootAbs = resolve(rootInput);

  return async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);

    if (pathname === '/api/snapshot' && req.method === 'GET') {
      const { snapshot, error } = scanHarness(rootAbs);
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
      const { status, body } = dispatchAction(rootAbs, payload);
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

    if (pathname.startsWith('/api/')) {
      return json(404, { ok: false, error: 'not_found', detail: `${req.method} ${pathname}` });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(405, { ok: false, error: 'method_not_allowed', detail: req.method });
    }

    if (!existsSync(DIST_INDEX)) {
      return json(500, { ok: false, error: 'build_missing', detail: 'Ejecutá `bun run build` antes de servir (falta dist/index.html)' });
    }
    const html = injectServeFlags(readFileSync(DIST_INDEX, 'utf8'), rootAbs);
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
}
