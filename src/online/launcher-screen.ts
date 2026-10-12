/**
 * LAUNCHER SCREEN — the hosted side of the web picker (spec 2026-10-11 §3.2 / §3.5).
 *
 * Online-unpaired boot lands here: the SITE generates the session code, shows the
 * one-line bootstrap command (`bun agent.ts <CODE>`), and waits for the headless
 * agent to join the room. Once the agent answers `/api/agent/status` the picker
 * state takes over (recents · native dialog · manual path) and a successful
 * `/api/agent/root` hands off to the existing dashboard boot. A paste-code
 * fallback covers the agent-generated flow (terminal printed the URL).
 */

import type { Transport, TransportStatus } from './transport.ts';
import { relayOverride } from './mode.ts';
import { extractCodeFromInput, generateCode, parseCodeFromHash, RELAY_URL } from './pairing.ts';
import { WSTransport } from './transport.ts';

export interface AgentStatus {
  state: 'picker' | 'running'
  root: string | null
}

export interface RecentEntryView {
  path: string
  lastUsed: number
}

const ERROR_TEXT = 'Código inválido — se esperan 26 caracteres (A–Z, 2–7) o la URL de pairing completa';

/** The one-liner the operator runs on their PC (base32 `[A-Z2-7]` — no shell quoting needed anywhere). */
export function commandText(code: string): string {
  return `bun agent.ts ${code}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Spanish relative time for recents entries ("hace 5 min"). Future timestamps clamp to "recién". */
export function formatLastUsed(lastUsed: number, now: number = Date.now()): string {
  const age = Math.max(0, now - lastUsed);
  if (age < MINUTE) { return 'recién'; }
  if (age < HOUR) { return `hace ${Math.floor(age / MINUTE)} min`; }
  if (age < DAY) { return `hace ${Math.floor(age / HOUR)} h`; }
  return `hace ${Math.floor(age / DAY)} d`;
}

export interface WaitForAgentOptions {
  /** Per-probe request budget — must beat the transport's 30s default. */
  probeTimeoutMs?: number
  /** Pause between failed probes. */
  probeIntervalMs?: number
  /** Cancel seam (tab teardown / boot handoff) — resolves `null` on the next check. */
  isCancelled?: () => boolean
  /** Bounded probing: give up (null) after this many failed attempts. Default: wait forever. */
  maxAttempts?: number
}

/**
 * Poll `/api/agent/status` until the agent answers (short timeouts — the room is
 * legitimately empty while the operator types the command on their PC). Returns
 * the agent status, or `null` when cancelled or out of attempts.
 */
export async function waitForAgent(
  transport: Transport,
  opts: WaitForAgentOptions = {},
): Promise<AgentStatus | null> {
  const probeTimeoutMs = opts.probeTimeoutMs ?? 4000;
  const probeIntervalMs = opts.probeIntervalMs ?? 2000;
  const isCancelled = opts.isCancelled ?? ((): boolean => false);
  const maxAttempts = opts.maxAttempts ?? Number.POSITIVE_INFINITY;
  let attempts = 0;
  while (!isCancelled()) {
    try {
      return await transport.api<AgentStatus>('GET', '/api/agent/status', undefined, probeTimeoutMs);
    }
    catch { /* agent not in the room yet (or probe budget expired) */ }
    attempts += 1;
    if (attempts >= maxAttempts) { return null; }
    await new Promise<void>(resolve => setTimeout(resolve, probeIntervalMs));
  }
  return null;
}

const CONN_TEXT: Record<TransportStatus, string> = {
  online: '● esperando agente en la sala…',
  connecting: '● conectando con el relay…',
  offline: '● relay inaccesible — reintentando…',
};

const PICKER_STATUS = '● agente conectado — elegí el harness';
const AGENT_GONE_STATUS = '● agente desconectado — corré el comando de nuevo';
const AGENT_GONE_ERROR = 'El agente se desconectó — corré el comando de nuevo (la sala sigue abierta)';
const BROWSE_TEXT = 'Elegir carpeta…';
const BROWSE_BUSY_TEXT = 'Abriendo el diálogo en la PC del agente…';

/**
 * Render the launcher screen into `#app` and wire the flow. The code lives only
 * in the URL fragment (`history.replaceState`, never localStorage): reloads keep
 * the session, closing the tab forgets it.
 */
export function renderLauncherScreen(onPaired: (code: string) => void): void {
  const app = document.getElementById('app');
  if (!app) { return; }

  let code = parseCodeFromHash(window.location.hash);
  if (code === null) {
    code = generateCode();
    // Keep query params (mode/relay test overrides) and replace only the fragment.
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#c=${code}`);
  }
  const cmd = commandText(code);
  const sessionCode = code;

  app.innerHTML = `
    <div class="pairing">
      <h1>Harness Manager</h1>
      <p class="pairing-hint">Corré este comando en la PC donde está tu harness (requiere Bun):</p>
      <div class="launcher-cmd">
        <code id="launcher-cmd-text">${cmd}</code>
        <button type="button" class="launcher-copy" id="launcher-copy" title="Copiar comando">copiar</button>
      </div>
      <div class="launcher-status" id="launcher-status">● esperando agente en la sala…</div>
      <p class="pairing-hint">¿Ya tenés el agente corriendo? Pegá su URL de pairing o código:</p>
      <form id="pairing-form" novalidate>
        <input id="pairing-input" class="pairing-input" type="text" placeholder="https://…/#c=…  o  ABCDEFGHJKMNPQRSTVWXYZ2345" autocomplete="off" spellcheck="false" />
        <div class="pairing-error" id="pairing-error" hidden></div>
        <button class="pairing-connect" type="submit">Conectar</button>
      </form>
      <div id="picker-slot"></div>
    </div>`;

  const statusEl = document.getElementById('launcher-status') as HTMLElement;
  const copyButton = document.getElementById('launcher-copy') as HTMLButtonElement;
  copyButton.addEventListener('click', () => {
    void navigator.clipboard.writeText(cmd).then(() => {
      copyButton.textContent = 'copiado ✓';
      setTimeout(() => { copyButton.textContent = 'copiar'; }, 1500);
    });
  });

  const form = document.getElementById('pairing-form') as HTMLFormElement;
  const input = document.getElementById('pairing-input') as HTMLInputElement;
  const errorEl = document.getElementById('pairing-error') as HTMLElement;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const pasted = extractCodeFromInput(input.value);
    if (pasted === null) {
      errorEl.textContent = ERROR_TEXT;
      errorEl.hidden = false;
      input.focus();
      return;
    }
    errorEl.hidden = true;
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#c=${pasted}`);
    // A pasted code means a different room — full reboot is the clean transport swap.
    window.location.reload();
  });

  let cancelled = false;
  let applyAgentPresence: ((present: boolean) => void) | null = null;
  const transport = new WSTransport({
    relayUrl: relayOverride(window.location.search) ?? RELAY_URL,
    code,
    onStatus: (status) => { statusEl.textContent = CONN_TEXT[status]; },
    onAgentPresence: (present) => { applyAgentPresence?.(present); },
  });

  void waitForAgent(transport, { isCancelled: () => cancelled }).then((status) => {
    if (status === null || cancelled) { return; }
    if (status.state === 'running') { // agent already bound (revisit/reload) — straight to the dashboard
      finish(transport);
      return;
    }
    renderPicker();
  });

  function finish(done: Transport): void {
    cancelled = true;
    done.close();
    onPaired(sessionCode);
  }

  function renderPicker(): void {
    const slot = document.getElementById('picker-slot');
    if (!slot) { return; }
    statusEl.textContent = PICKER_STATUS;
    slot.innerHTML = `
      <p class="pairing-hint">Elegí el harness en la PC del agente:</p>
      <div class="picker-recents" id="picker-recents"></div>
      <div class="picker-row">
        <button type="button" class="pairing-connect" id="picker-browse">${BROWSE_TEXT}</button>
      </div>
      <form id="picker-path-form" novalidate>
        <input id="picker-path" class="pairing-input" type="text" placeholder="o pegá la ruta absoluta: C:\\…  /  home/…" autocomplete="off" spellcheck="false" />
        <div class="pairing-error" id="picker-error" hidden></div>
        <button class="pairing-connect" id="picker-submit" type="submit">Usar esta ruta</button>
      </form>`;

    const errorEl2 = document.getElementById('picker-error') as HTMLElement;
    const pathInput = document.getElementById('picker-path') as HTMLInputElement;
    const browseButton = document.getElementById('picker-browse') as HTMLButtonElement;
    const submitButton = document.getElementById('picker-submit') as HTMLButtonElement;

    // The picker only renders when the agent just answered — presence keeps it truthful from
    // here on: agent gone → freeze the controls + explain; agent back → restore (same room).
    let agentPresent = true;
    let browseBusy = false;
    applyAgentPresence = (present) => {
      agentPresent = present;
      statusEl.textContent = present ? PICKER_STATUS : AGENT_GONE_STATUS;
      submitButton.disabled = !present;
      browseButton.disabled = !present || browseBusy;
      if (present) {
        errorEl2.hidden = true;
      }
      else {
        errorEl2.textContent = AGENT_GONE_ERROR;
        errorEl2.hidden = false;
      }
    };

    void transport.api<RecentEntryView[]>('GET', '/api/agent/recents', undefined, 8000).then((entries) => {
      const recentsEl = document.getElementById('picker-recents');
      if (!recentsEl || !Array.isArray(entries) || entries.length === 0) { return; }
      recentsEl.innerHTML = entries.map(entry => `
        <button type="button" class="picker-recent" data-path="${entry.path.replace(/"/g, '&quot;')}">
          <span class="picker-recent-path">${entry.path}</span>
          <span class="picker-recent-time">${formatLastUsed(entry.lastUsed)}</span>
        </button>`).join('');
      recentsEl.querySelectorAll<HTMLButtonElement>('.picker-recent').forEach((button) => {
        button.addEventListener('click', () => { void bindRoot(button.dataset.path ?? ''); });
      });
    }).catch(() => { /* recents are optional — agent gone/timeout already surfaced elsewhere */ });

    browseButton.addEventListener('click', () => {
      browseBusy = true;
      browseButton.disabled = true;
      browseButton.textContent = BROWSE_BUSY_TEXT; // the dialog opens on the AGENT's PC, not here
      errorEl2.hidden = true;
      // The native dialog is user-paced — generous budget (spec §3.3). Agent 4xx bodies RESOLVE
      // (transport resolves any status) — handle the shape here instead of via catch.
      transport.api<{ path?: string | null, error?: string }>('POST', '/api/agent/browse', {}, 120_000)
        .then((result) => {
          if (result.path) { void bindRoot(result.path); }
          else if (result.error) {
            errorEl2.textContent = `${result.error} — usá la ruta manual de acá abajo`;
            errorEl2.hidden = false;
          }
        })
        .catch((error: unknown) => {
          const message = messageOf(error);
          // Agent gone → the transport fails fast instead of hanging the whole 120s budget.
          errorEl2.textContent = message === 'agente desconectado' ? AGENT_GONE_ERROR : `${message} — usá la ruta manual de acá abajo`;
          errorEl2.hidden = false;
        })
        .finally(() => {
          browseBusy = false;
          browseButton.textContent = BROWSE_TEXT;
          browseButton.disabled = !agentPresent;
        });
    });

    document.getElementById('picker-path-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      errorEl2.hidden = true;
      void bindRoot(pathInput.value.trim());
    });

    async function bindRoot(root: string): Promise<void> {
      if (root === '') {
        errorEl2.textContent = 'Falta la ruta del harness.';
        errorEl2.hidden = false;
        return;
      }
      try {
        const result = await transport.api<{ ok: boolean, detail?: string }>('POST', '/api/agent/root', { root }, 15_000);
        if (result.ok) { finish(transport); }
        else {
          errorEl2.textContent = result.detail ?? 'No se pudo usar esa ruta.';
          errorEl2.hidden = false;
        }
      }
      catch (error) {
        errorEl2.textContent = messageOf(error);
        errorEl2.hidden = false;
      }
    }
  }
}

/** Transport-level failures are plain Errors (timeout, conexión perdida). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
