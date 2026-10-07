import { choiceModal } from './components/confirm-modal.ts';
import { toast } from './components/toast.ts';
import { escapeHtml } from './html.ts';
import { meta } from './model.ts';
import { refreshSnapshot } from './refresh.ts';
import { actionsEnabled, isLauncherMode, isServeMode, setEngineBase } from './serve.ts';
import { notify } from './state.ts';

/** Mirrors the launcher API (`src/launcher/app.ts`). */
export interface ServerStatusBody {
  ok: boolean
  engine: 'running' | 'starting' | 'stopped'
  engineUrl: string | null
  root: string
  pid: number | null
  error?: string
  already?: boolean
  detail?: string
}

const LAUNCHER_PORT = 7397;

let status: ServerStatusBody | null = isLauncherMode
  ? { ok: true, engine: 'starting', engineUrl: null, root: '', pid: null }
  : null;
let awaitingStart = false;
let pollTimer: number | null = null;

function launcherUrl(pathname: string): string {
  return `${window.location.origin}${pathname}`;
}

async function launcherFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(launcherUrl(pathname), init);
  return await response.json() as T;
}

/** Status transitions → engine base, toasts, full re-render (views re-enable/disable). */
function applyStatus(next: ServerStatusBody): void {
  const prev = status;
  status = next;
  const engineChanged = (prev?.engine ?? null) !== next.engine || (prev?.engineUrl ?? null) !== next.engineUrl;
  if (!engineChanged) { return; }
  setEngineBase(next.engineUrl);
  if (awaitingStart && next.engine === 'running') {
    awaitingStart = false;
    toast('servidor iniciado', 'ok');
  }
  if (prev?.engine === 'running' && next.engine === 'stopped') {
    toast(
      next.error ? `servidor detenido — ${next.error}` : 'servidor detenido — la vista queda en solo lectura',
      next.error ? 'error' : 'info',
    );
  }
  notify();
}

async function pollOnce(): Promise<void> {
  if (!isLauncherMode) { return; }
  try {
    const body = await launcherFetch<ServerStatusBody>('/api/status');
    if (body.ok) { applyStatus(body); }
  }
  catch { /* launcher unreachable — keep last known state */ }
}

/** Immediate poll + every 3s (launcher mode only). */
export function startServerControl(): void {
  if (!isLauncherMode || pollTimer !== null) { return; }
  void pollOnce();
  pollTimer = window.setInterval(() => { void pollOnce(); }, 3000);
}

export async function startEngine(): Promise<void> {
  if (!isLauncherMode) { await fileModeStartFlow(); return; }
  awaitingStart = true;
  const base = status ?? { ok: true, engine: 'starting' as const, engineUrl: null, root: '', pid: null };
  applyStatus({ ...base, engine: 'starting', engineUrl: null, error: undefined });
  try {
    const body = await launcherFetch<ServerStatusBody>('/api/start', { method: 'POST' });
    if (!body.ok) {
      awaitingStart = false;
      toast(`No se pudo iniciar: ${body.detail ?? body.error ?? 'error desconocido'}`, 'error');
      await pollOnce();
      return;
    }
    applyStatus(body);
    void refreshSnapshot(); // engine re-scanned on boot — pull the fresh snapshot in place
  }
  catch (error) {
    awaitingStart = false;
    toast(`Sin conexión con el launcher: ${String(error)}`, 'error');
  }
}

export async function stopEngine(): Promise<void> {
  if (!isLauncherMode) { return; }
  try {
    const body = await launcherFetch<ServerStatusBody>('/api/stop', { method: 'POST' });
    if (!body.ok) {
      toast(`No se pudo detener: ${body.detail ?? body.error ?? 'error desconocido'}`, 'error');
      await pollOnce();
      return;
    }
    applyStatus(body);
  }
  catch (error) {
    toast(`Sin conexión con el launcher: ${String(error)}`, 'error');
  }
}

export async function onServerButtonClick(): Promise<void> {
  if (isServeMode) { return; }
  if (status?.engine === 'running') { await stopEngine(); }
  else { await startEngine(); }
}

/**
 * file:// (or dev) mode: the browser cannot spawn processes. Probe the fixed launcher
 * port; if a launcher is up, offer to open it there; otherwise hand over the command.
 */
async function fileModeStartFlow(): Promise<void> {
  const launcherOrigin = `http://127.0.0.1:${LAUNCHER_PORT}`;
  let reachable = false;
  try {
    const response = await fetch(`${launcherOrigin}/api/status`, { signal: AbortSignal.timeout(1200) });
    reachable = response.ok;
  }
  catch { reachable = false; }

  if (reachable) {
    const open = await choiceModal({
      title: 'Launcher detectado',
      bodyHtml: '<div class="modal-summary">Hay un launcher corriendo en 127.0.0.1:7397. ¿Abrir la interfaz desde allí? (con el servidor bajo control start/stop)</div>',
      confirmLabel: 'Abrir en el launcher',
      cancelLabel: 'Cancelar',
    });
    if (open) { window.location.href = `${launcherOrigin}/`; }
    return;
  }

  const command = `bun run serve --root "${meta.root}"`;
  await choiceModal({
    title: 'Servidor no iniciado',
    bodyHtml: `
      <div class="modal-summary">Esta vista es un archivo estático: el navegador no puede arrancar el proceso por sí solo. Corré este comando en una terminal:</div>
      <div class="cmd-row"><code id="cmd-text">${escapeHtml(command)}</code><button class="copy-btn" id="cmd-copy">Copiar comando</button></div>`,
    confirmLabel: 'Entendido',
    onMount: (overlay) => {
      overlay.querySelector<HTMLButtonElement>('#cmd-copy')?.addEventListener('click', () => {
        const fallback = (): void => {
          const node = overlay.querySelector('#cmd-text');
          if (!node) { return; }
          const range = document.createRange();
          range.selectNodeContents(node);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        };
        if (navigator.clipboard) {
          navigator.clipboard.writeText(command)
            .then(() => toast('comando copiado', 'ok'))
            .catch(fallback);
        }
        else { fallback(); }
      });
    },
  });
}

function renderBadge(): void {
  const badge = document.getElementById('mode-badge');
  if (!badge) { return; }
  const available = actionsEnabled();
  badge.classList.toggle('serve', available);
  badge.textContent = available ? 'modo serve · escritura' : 'modo solo lectura';
}

/** Header control block — launcher mode: dot + label + Iniciar/Detener; file mode: Iniciar. */
export function renderServerControl(): void {
  const slot = document.getElementById('server-control');
  if (!slot) { return; }
  renderBadge();

  if (isServeMode) { slot.innerHTML = ''; return; }

  if (isLauncherMode) {
    const engine = status?.engine ?? 'starting';
    const dotClass = engine === 'running' ? 'ok' : engine === 'starting' ? 'warn' : 'bad';
    const label = engine === 'running' ? 'servidor en marcha' : engine === 'starting' ? 'iniciando…' : 'servidor detenido';
    const button = engine === 'starting'
      ? '<button class="action" disabled>Iniciando…</button>'
      : `<button class="action" id="btn-server">${engine === 'running' ? 'Detener servidor' : 'Iniciar servidor'}</button>`;
    const errorTitle = status?.error ? ` title="${escapeHtml(status.error)}"` : '';
    slot.innerHTML = `<span class="server-ctl"><span class="dot ${dotClass}"></span><span class="server-label"${errorTitle}>${label}</span>${button}</span>`;
  }
  else {
    slot.innerHTML = '<button class="action" id="btn-server" title="Intenta conectar con un launcher en 127.0.0.1:7397">Iniciar servidor</button>';
  }

  slot.querySelector<HTMLButtonElement>('#btn-server')?.addEventListener('click', () => { void onServerButtonClick(); });
}
