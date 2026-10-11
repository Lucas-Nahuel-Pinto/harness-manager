/**
 * DESKTOP VIEW — rendering shell for the desktop controller (spec §3.4/§3.8).
 *
 * RPC client only: no engine/process logic. Every dynamic value is set via
 * `textContent`/DOM APIs (never innerHTML), so a malicious path or server
 * message cannot inject markup. Tokens are self-contained copies of the
 * launcher picker's dark palette (src/launcher/picker.ts).
 */

import type {
  BrowseResult,
  DesktopPickResult,
  DesktopRPCSchema,
  DesktopSnapshot,
} from '../rpc-schema.ts';
import { Electroview } from 'electrobun/view';

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) { throw new Error(`falta el elemento #${id}`); }
  return node;
}

const toastEl = el('toast');
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4000);
}

let busy = false;

async function withBusy(fn: () => Promise<void>): Promise<void> {
  if (busy) { return; }
  busy = true;
  try {
    await fn();
  }
  finally {
    busy = false;
  }
}

const PANEL_IDS: Record<DesktopSnapshot['state'], string> = {
  picker: 'panel-picker',
  starting: 'panel-starting',
  running: 'panel-running',
  crashed: 'panel-crashed',
  error: 'panel-error',
};

function renderRecents(recents: DesktopSnapshot['recents']): void {
  const list = el('recents-list');
  list.replaceChildren();
  el('recents-empty').hidden = recents.length > 0;
  list.hidden = recents.length === 0;
  for (const entry of recents) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent';
    const path = document.createElement('code');
    path.className = 'path';
    path.textContent = entry.path;
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = new Date(entry.lastUsed).toLocaleString();
    button.append(path, when);
    button.addEventListener('click', () => {
      void withBusy(async () => { await pickRoot(entry.path); });
    });
    const item = document.createElement('li');
    item.append(button);
    list.append(item);
  }
}

function render(snapshot: DesktopSnapshot): void {
  for (const [state, id] of Object.entries(PANEL_IDS)) {
    el(id).hidden = state !== snapshot.state;
  }
  if (snapshot.state === 'picker') {
    renderRecents(snapshot.recents);
    el('root-input').focus();
  }
  if (snapshot.state === 'running') {
    el('running-root').textContent = snapshot.root ?? '';
    el('pairing-url').textContent = snapshot.pairingUrl ?? '';
  }
  if (snapshot.state === 'crashed') {
    el('crashed-root').textContent = snapshot.root ?? '';
  }
  if (snapshot.state === 'error') {
    el('error-detail').textContent = snapshot.detail ?? '';
  }
}

const rpc = Electroview.defineRPC<DesktopRPCSchema>({
  // pickRoot awaits the engine's `Online:` line — well past the 1s RPC default.
  maxRequestTime: 30000,
  handlers: {
    requests: {},
    messages: {
      state: (snapshot) => { render(snapshot); },
    },
  },
});
void new Electroview({ rpc }); // constructor wires the encrypted transport onto `rpc`

async function pickRoot(path: string): Promise<void> {
  const result: DesktopPickResult = await rpc.request.pickRoot({ path });
  if (!result.ok) {
    toast(result.detail || 'No se pudo usar esa ruta.');
  }
}

async function browseFlow(): Promise<void> {
  const result: BrowseResult = await rpc.request.browse();
  if (result.ok && 'cancelled' in result && result.cancelled) { return; }
  if (result.ok && 'path' in result && result.path) {
    await pickRoot(result.path);
    return;
  }
  if (!result.ok && result.error === 'browse_unsupported') {
    toast('Diálogo no disponible — pegá la ruta abajo.');
    return;
  }
  toast(!result.ok ? result.detail : 'No se pudo abrir el diálogo de carpetas.');
}

async function backToPicker(): Promise<void> {
  await rpc.request.reset();
}

el('browse').addEventListener('click', () => {
  void withBusy(browseFlow);
});

const input = el('root-input') as HTMLInputElement;
const useButton = el('use-path');
useButton.addEventListener('click', () => {
  const path = input.value.trim();
  if (!path) { toast('Pegá una ruta absoluta.'); return; }
  void withBusy(async () => { await pickRoot(path); });
});
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { useButton.click(); }
});

el('open-app').addEventListener('click', () => {
  // Explicit click — the main process opens the browser even with HM_NO_OPEN set.
  void withBusy(async () => {
    const result = await rpc.request.openApp();
    if (!result.ok) { toast('No se pudo abrir el navegador.'); }
  });
});
el('crashed-back').addEventListener('click', () => {
  void withBusy(backToPicker);
});
el('error-back').addEventListener('click', () => {
  void withBusy(backToPicker);
});

void rpc.request.getInitial().then(render);
