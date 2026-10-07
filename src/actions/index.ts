import type { ActionResult, ComputeResult } from './types.ts';
import { scanHarness } from '../scan/index.ts';
import { applyAndRescan } from './apply.ts';
import { unifiedDiff } from './diff.ts';
import { resolveInRoot } from './guard.ts';
import { computeMcpToggle } from './mcp-toggle.ts';
import { computeModelSet } from './model-set.ts';
import { openInOs } from './open.ts';
import { errorResult } from './types.ts';

export type { ActionResult, ApiBody } from './types.ts';

/**
 * Staged action dispatcher — THE server-enforced contract:
 * stage 1 (no `confirm`) only ever returns diff + summary, stage 2 (`confirm: true`)
 * recomputes, re-guards and applies atomically. Unknown kinds and bad shapes → 400.
 */
export function dispatchAction(rootAbs: string, rawBody: unknown): ActionResult {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return errorResult(400, 'bad_body', 'se espera un objeto { kind, target?, payload?, confirm? }');
  }
  const body = rawBody as Record<string, unknown>;
  const { kind } = body;
  if (typeof kind !== 'string' || kind.length === 0) {
    return errorResult(400, 'bad_body', 'falta kind');
  }
  const confirm = body.confirm === true;
  const payload = (body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
    ? body.payload
    : {}) as Record<string, unknown>;

  switch (kind) {
    case 'mcp-toggle':
      return stageOrApply(rootAbs, confirm, computeMcpToggle(rootAbs, payload));
    case 'model-set':
      return stageOrApply(rootAbs, confirm, computeModelSet(rootAbs, payload));
    case 'open-path':
      return openPath(rootAbs, body.target);
    default:
      return errorResult(400, 'unknown_kind', `kind desconocido: ${kind}`);
  }
}

/** Read-only OS open — no confirm needed (nothing is written). */
function openPath(rootAbs: string, target: unknown): ActionResult {
  if (typeof target !== 'string' || target.length === 0) {
    return errorResult(400, 'bad_body', 'falta target');
  }
  const abs = resolveInRoot(rootAbs, target);
  if (!abs) { return errorResult(400, 'path_escape', `ruta fuera del harness root: ${target}`); }
  const { ok } = openInOs(abs);
  return ok
    ? { status: 200, body: { ok: true } }
    : { status: 200, body: { ok: false, error: 'open_failed', detail: 'el sistema operativo no pudo abrir el archivo' } };
}

function stageOrApply(rootAbs: string, confirm: boolean, computed: ComputeResult): ActionResult {
  if (!computed.ok) { return errorResult(computed.status, computed.code, computed.detail); }

  const { relPath, absPath, oldText, newText, summary } = computed.computed;
  if (!confirm) {
    const diff = oldText === newText ? '' : unifiedDiff(oldText, newText, relPath);
    return { status: 200, body: { ok: true, stage: 'confirm', diff, summary } };
  }

  if (newText === oldText) {
    const { snapshot, error } = scanHarness(rootAbs);
    if (!snapshot) { return errorResult(500, 'rescan_failed', error ?? 'scan failed'); }
    return { status: 200, body: { ok: true, snapshot } };
  }

  // Re-guard at apply time: stage 2 recomputes from CURRENT disk content.
  const guarded = resolveInRoot(rootAbs, relPath);
  if (!guarded || guarded !== absPath) {
    return errorResult(400, 'path_escape', `ruta fuera del harness root: ${relPath}`);
  }
  const applied = applyAndRescan(rootAbs, guarded, newText);
  if (!applied.ok || !applied.snapshot) {
    return errorResult(500, applied.error ?? 'write_failed', applied.detail ?? 'no se pudo aplicar el cambio');
  }
  return { status: 200, body: { ok: true, snapshot: applied.snapshot } };
}
