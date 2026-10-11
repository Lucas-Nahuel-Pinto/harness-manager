/**
 * AGENT CONTROLLER — pure lifecycle for the headless web-controlled agent (spec §3).
 *
 * The agent IS the engine (spec §3.1): it joins the relay with this handler and
 * picking a root just binds `createApp(root)` IN-PROCESS — no child spawn, no
 * `Online:` stdout capture, no kill escalation. Route order (spec §3.3):
 * `/api/agent/*` control routes win, everything else delegates to the bound
 * dashboard handler, and an unbound agent answers 404 `no_root`.
 *
 * Every external seam is injectable (`createAppFactory`, `pickFolder`,
 * `recentsFile`) so unit tests run with zero real dialogs, files, or network.
 */

import type { FetchHandler } from '../online/relay-client.ts';
import type { RecentEntry } from './recents.ts';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createApp } from '../server/app.ts';
import { pickFolder as defaultPickFolder } from './browse.ts';
import { addRecent, loadRecents, saveRecents } from './recents.ts';

export type AgentState = 'picker' | 'running';

export type BindResult = { ok: true } | { ok: false, detail: string };

export interface AgentControllerOptions {
  /** DI — dashboard handler factory for a root; tests inject a recording fake. Defaults to `createApp`. */
  createAppFactory?: (rootAbs: string) => FetchHandler
  /** DI — native folder dialog; tests inject a fake (never open a real dialog). */
  pickFolder?: () => Promise<string | null>
  /** Recents persistence — defaults to `data/recents.json` next to the repo (cwd-independent). */
  recentsFile?: string
}

export interface AgentController {
  /** The relay fetch-handler: agent routes → bound dashboard → `no_root` 404. */
  handler: FetchHandler
  getState: () => AgentState
  /** Bound harness root, or null while in picker state. */
  getRoot: () => string | null
  /** Validate + bind in place (rebind allowed while running, spec §3.9). Recents only on success. */
  bindRoot: (path: string) => BindResult
  recents: () => RecentEntry[]
}

/** Spanish validation messages (same copy as the retired desktop controller). */
function validateRoot(path: string): string | null {
  if (path.trim() === '') { return 'Falta la ruta del harness (path).'; }
  if (!isAbsolute(path)) { return `La ruta debe ser absoluta: ${path}`; }
  if (!existsSync(path)) { return `La ruta no existe: ${path}`; }
  try {
    if (!statSync(path).isDirectory()) { return `La ruta no es un directorio: ${path}`; }
  }
  catch { return `La ruta no es un directorio: ${path}`; } // deleted between checks — same failure as invalid
  return null;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function createAgentController(opts: AgentControllerOptions = {}): AgentController {
  const createAppFactory = opts.createAppFactory ?? createApp;
  const pickFolder = opts.pickFolder ?? defaultPickFolder;
  const recentsFile = opts.recentsFile ?? `${import.meta.dir}/../../data/recents.json`;

  let bound: FetchHandler | null = null;
  let root: string | null = null;

  function bindRoot(path: string): BindResult {
    const invalid = validateRoot(path);
    if (invalid !== null) { return { ok: false, detail: invalid }; }
    bound = createAppFactory(path);
    root = path;
    try {
      saveRecents(recentsFile, addRecent(loadRecents(recentsFile), path));
    }
    catch { /* recents persistence must not fail a successful bind */ }
    return { ok: true };
  }

  async function handleAgentRoute(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'GET' && path === '/api/agent/status') {
      return json(200, { state: bound ? 'running' : 'picker', root });
    }
    if (req.method === 'GET' && path === '/api/agent/recents') {
      return json(200, loadRecents(recentsFile));
    }
    if (req.method === 'POST' && path === '/api/agent/browse') {
      // The dialog is user-paced — the CALLER sets the generous timeout (spec §3.3).
      try {
        return json(200, { path: await pickFolder() });
      }
      catch (error) {
        const code = (error as { code?: string }).code;
        return json(400, { error: messageOf(error), code: code ?? 'browse_failed' });
      }
    }
    if (req.method === 'POST' && path === '/api/agent/root') {
      let requested: unknown;
      try { requested = JSON.parse(await req.text()) as unknown; }
      catch { return json(400, { ok: false, detail: 'Body JSON inválido.' }); }
      const rootPath = (requested as { root?: unknown } | null)?.root;
      if (typeof rootPath !== 'string') { return json(400, { ok: false, detail: 'Falta la ruta del harness (root).' }); }
      const result = bindRoot(rootPath);
      if (!result.ok) { return json(400, result); }
      return json(200, { ok: true, state: 'running', root });
    }
    return null;
  }

  const handler: FetchHandler = async (req) => {
    const agentResponse = await handleAgentRoute(req);
    if (agentResponse !== null) { return agentResponse; }
    if (bound !== null) { return bound(req); }
    return json(404, { error: 'no_root' });
  };

  return {
    handler,
    getState: () => (bound ? 'running' : 'picker'),
    getRoot: () => root,
    bindRoot,
    recents: () => loadRecents(recentsFile),
  };
}
