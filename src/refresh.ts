import type { ApiBody } from './actions/types.ts';
import type { HarnessSnapshot } from './types.ts';
import { alertModal, confirmModal } from './components/confirm-modal.ts';
import { toast } from './components/toast.ts';
import { refreshModel } from './model.ts';
import { actionsEnabled, apiGet, apiPost } from './serve.ts';
import { setSnapshot } from './snapshot.ts';
import { notify } from './state.ts';
import { rebuildGraph } from './views/graph.ts';

function applySnapshot(snapshot: HarnessSnapshot): void {
  setSnapshot(snapshot);
  refreshModel();
  rebuildGraph();
  notify();
}

function failure(body: ApiBody, fallback: string): string {
  return body.detail ?? body.error ?? fallback;
}

/** GET /api/snapshot → replace in-memory model + graph, notify renderers. */
export async function refreshSnapshot(): Promise<void> {
  if (!actionsEnabled()) { return; }
  try {
    const body = await apiGet('/api/snapshot');
    if (!body.ok || !body.snapshot) {
      toast(failure(body, 'No se pudo re-scanear'), 'error');
      return;
    }
    applySnapshot(body.snapshot);
    toast('Snapshot actualizado', 'ok');
  }
  catch (error) {
    toast(`Sin conexión con el servidor: ${String(error)}`, 'error');
  }
}

export interface ActionRequest {
  kind: 'mcp-toggle' | 'model-set' | 'open-path'
  target?: string
  payload?: Record<string, unknown>
  /** Pre-approved (skips the confirm modal) — used for self-evident read-only opens. */
  autoConfirm?: boolean
}

/**
 * The full staged flow in one call: stage 1 → confirm modal (diff) → stage 2 → apply snapshot.
 * Returns true when the change was applied (or the action succeeded without a change).
 */
export async function runStagedAction(request: ActionRequest, title: string): Promise<boolean> {
  if (!actionsEnabled()) { return false; }
  try {
    const first = await apiPost<ApiBody>('/api/action', { kind: request.kind, target: request.target, payload: request.payload });
    if (!first.ok) {
      toast(failure(first, 'La acción falló'), 'error');
      return false;
    }
    if (first.stage !== 'confirm') {
      // open-path (read-only) and other non-staged answers
      if (first.snapshot) { applySnapshot(first.snapshot); }
      return true;
    }
    if (!request.autoConfirm) {
      const approved = await confirmModal({ title, summary: first.summary ?? '', diff: first.diff ?? '' });
      if (!approved) { return false; }
    }
    const second = await apiPost<ApiBody>('/api/action', { kind: request.kind, target: request.target, payload: request.payload, confirm: true });
    if (!second.ok) {
      toast(failure(second, 'No se pudo aplicar el cambio'), 'error');
      return false;
    }
    if (second.snapshot) { applySnapshot(second.snapshot); }
    toast(first.summary ?? 'Cambio aplicado', 'ok');
    return true;
  }
  catch (error) {
    toast(`Sin conexión con el servidor: ${String(error)}`, 'error');
    return false;
  }
}

/** POST /api/run → toast on completion, then show the captured output in a modal. */
export async function runScriptByName(name: string): Promise<boolean> {
  if (!actionsEnabled()) { return false; }
  try {
    const body = await apiPost<ApiBody>('/api/run', { name });
    const ran = typeof body.output === 'string';
    if (!ran) {
      toast(failure(body, `No se pudo correr "${name}"`), 'error');
      return false;
    }
    if (body.ok) {
      toast(`Script "${name}" OK (exit 0)`, 'ok');
    }
    else if (body.error === 'timeout') {
      toast(failure(body, `Script "${name}" superó el tiempo máximo`), 'error');
    }
    else {
      toast(`Script "${name}" falló (exit ${body.exitCode ?? '—'})`, 'error');
    }
    await alertModal(`Salida — ${name}`, body.output ?? '');
    return Boolean(body.ok);
  }
  catch (error) {
    toast(`Sin conexión con el servidor: ${String(error)}`, 'error');
    return false;
  }
}
