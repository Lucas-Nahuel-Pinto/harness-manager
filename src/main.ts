import type { AgentStatus } from './online/launcher-screen.ts';
import type { TransportStatus } from './online/transport.ts';
import type { EnvStatus, GraphKind, TabId } from './state.ts';
import type { SkillTier } from './types.ts';
import { escapeHtml, renderDetail } from './components/detail-panel.ts';
import { agentHosts, graphKindLabels, mcpConfigFiles, meta, warningCount } from './model.ts';
import { renderLauncherScreen, waitForAgent } from './online/launcher-screen.ts';
import { detectMode, relayOverride } from './online/mode.ts';
import { parseCodeFromHash, RELAY_URL } from './online/pairing.ts';
import { WSTransport } from './online/transport.ts';
import { refreshSnapshot } from './refresh.ts';
import { actionsEnabled, actionsHint, enableOnlineMode } from './serve.ts';
import {
  ALL_GRAPH_KINDS,
  getState,
  notify,
  setDetailCollapsed,
  setEnvStatus,
  setFiltersCollapsed,
  setSearch,
  setTab,
  subscribe,
  toggleFlag,
  toggleGraphKind,
  toggleHost,
  toggleMcpConfig,
  toggleTier,
  toggleWarnings,
} from './state.ts';
import { injectStyles } from './styles.ts';
import { renderAgents } from './views/agents.ts';
import { renderGraph, resizeGraph } from './views/graph.ts';
import { renderMcpEnv } from './views/mcp-env.ts';
import { renderResumen } from './views/resumen.ts';
import { renderScriptsRegistry } from './views/scripts-registry.ts';
import { renderSkills } from './views/skills.ts';

const TABS: { id: TabId, label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'skills', label: 'Skills + Commands' },
  { id: 'agents', label: 'Agents & Modelos' },
  { id: 'mcp-env', label: 'MCPs + Env' },
  { id: 'scripts', label: 'Scripts + Registros' },
  { id: 'graph', label: 'Grafo' },
];

const TIERS: SkillTier[] = ['T1', 'T2', 'T3', 'T4'];

const ENV_STATUS_OPTIONS: [EnvStatus, string][] = [
  ['all', 'Todas'],
  ['both', 'Ambas presentes'],
  ['example-only', 'Solo .env.example'],
  ['env-only', 'Solo .env'],
  ['missing', 'Ausentes'],
];

const CONN_TEXT: Record<TransportStatus, string> = {
  online: '● online',
  connecting: '● conectando',
  offline: '● offline',
};

const CONN_TONE: Record<TransportStatus, string> = {
  online: 'ok',
  connecting: 'warn',
  offline: 'bad',
};

injectStyles();

function bootApp(): void {
  const app = document.getElementById('app') as HTMLElement;
  app.innerHTML = `
  <header class="topbar">
    <h1>Harness Manager</h1>
    <span class="meta root" title="${escapeHtml(meta.root)}">${escapeHtml(meta.root)}</span>
    <span class="meta" id="freshness"></span>
    <span class="spacer"></span>
    <span id="warn-slot"></span>
    <span class="conn-badge" id="conn-badge" hidden></span>
    <span class="badge-ro serve" id="mode-badge">modo online · escritura</span>
  </header>
  <div class="conn-banner" id="conn-banner" hidden>Sin conexión con el motor — reintentando…</div>
  <nav class="tabs" id="tabs"></nav>
  <div class="workspace">
    <nav class="filters" id="filters">
      <button class="panel-toggle" id="toggle-filters" title="Colapsar filtros">«</button>
      <span class="search-label">Buscar</span>
      <input id="search" class="search" type="search" placeholder="nombre, ruta o descripción (/)" autocomplete="off" />
      <div id="filter-controls"></div>
      <div class="filter-actions">
        <button class="action" id="btn-rescan" disabled>Re-scan</button>
      </div>
    </nav>
    <main class="view" id="view"></main>
    <aside class="detail" id="detail">
      <button class="panel-toggle" id="toggle-detail" title="Colapsar panel de detalles">»</button>
      <div id="detail-body"></div>
    </aside>
  </div>
`;

  const tabsEl = document.getElementById('tabs') as HTMLElement;
  const filterControlsEl = document.getElementById('filter-controls') as HTMLElement;
  const viewEl = document.getElementById('view') as HTMLElement;
  const detailBodyEl = document.getElementById('detail-body') as HTMLElement;
  const searchEl = document.getElementById('search') as HTMLInputElement;

  function snapshotAge(): string {
    if (meta.root === '') { return 'Esperando motor…'; } // online build: empty shell until the engine answers
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(meta.scannedAt)) / 60_000));
    if (minutes < 1) { return 'snapshot hace instantes'; }
    if (minutes < 60) { return `snapshot hace ${minutes} min`; }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) { return `snapshot hace ${hours} h`; }
    return `snapshot hace ${Math.floor(hours / 24)} d`;
  }

  function renderFreshness(): void {
    const el = document.getElementById('freshness');
    if (el) { el.textContent = snapshotAge(); }
  }

  function renderTabs(): void {
    const { tab } = getState();
    tabsEl.innerHTML = TABS.map(({ id, label }) => {
      const active = id === tab ? ' active' : '';
      return `<button class="tab${active}" data-tab="${id}">${label}</button>`;
    }).join('');
    tabsEl.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => setTab(button.dataset.tab as TabId));
    });
  }

  function checkItem(filter: string, value: string, checked: boolean, label: string): string {
    return `<label class="filter-item"><input type="checkbox" data-filter="${filter}" value="${escapeHtml(value)}"${checked ? ' checked' : ''} />${escapeHtml(label)}</label>`;
  }

  function radioItem(value: string, checked: boolean, label: string): string {
    return `<label class="filter-item"><input type="radio" name="env-status" data-filter="env" value="${escapeHtml(value)}"${checked ? ' checked' : ''} />${escapeHtml(label)}</label>`;
  }

  function filterGroup(title: string, body: string): string {
    return `<h4>${title}</h4>${body}`;
  }

  function renderFilterControls(): void {
    const { tab, filters } = getState();
    let html = '<div class="filter-note">Sin filtros para esta pestaña</div>';
    if (tab === 'skills') {
      html = filterGroup('Tier', TIERS.map(tier => checkItem('tier', tier, filters.tiers.includes(tier), tier)).join(''))
        + filterGroup('Estado', checkItem('flag', 'registeredOnly', filters.registeredOnly, 'Solo registrados')
        + checkItem('flag', 'vendoredOnly', filters.vendoredOnly, 'Solo vendored'));
    }
    else if (tab === 'agents') {
      html = agentHosts.length > 0
        ? filterGroup('Host', agentHosts.map(host => checkItem('host', host, filters.hosts.includes(host), host)).join(''))
        : '<div class="filter-note">Sin agentes en el snapshot</div>';
    }
    else if (tab === 'mcp-env') {
      html = (mcpConfigFiles.length > 0
        ? filterGroup('Archivo MCP', mcpConfigFiles.map(file => checkItem('mcp', file, filters.mcpConfigFiles.includes(file), file)).join(''))
        : '')
      + filterGroup('Env', ENV_STATUS_OPTIONS
        .map(([value, label]) => radioItem(value, filters.envStatus === value, label))
        .join(''));
    }
    else if (tab === 'graph') {
      html = filterGroup('Tipo de nodo', ALL_GRAPH_KINDS
        .map(kind => checkItem('graphkind', kind, filters.graphKinds.includes(kind), graphKindLabels[kind]))
        .join(''));
    }
    filterControlsEl.innerHTML = html;
    filterControlsEl.querySelectorAll<HTMLInputElement>('input[data-filter]').forEach((input) => {
      const kind = input.dataset.filter;
      if (kind === 'tier') {
        input.addEventListener('change', () => toggleTier(input.value as SkillTier));
      }
      else if (kind === 'host') {
        input.addEventListener('change', () => toggleHost(input.value));
      }
      else if (kind === 'mcp') {
        input.addEventListener('change', () => toggleMcpConfig(input.value));
      }
      else if (kind === 'flag') {
        input.addEventListener('change', () => toggleFlag(input.value as 'registeredOnly' | 'vendoredOnly'));
      }
      else if (kind === 'env') {
        input.addEventListener('change', () => setEnvStatus(input.value as EnvStatus));
      }
      else if (kind === 'graphkind') {
        input.addEventListener('change', () => toggleGraphKind(input.value as GraphKind));
      }
    });
  }

  function applyCollapse(): void {
    const { filtersCollapsed, detailCollapsed } = getState();
    const filtersEl = document.getElementById('filters') as HTMLElement;
    const detailEl = document.getElementById('detail') as HTMLElement;
    const filtersToggle = document.getElementById('toggle-filters') as HTMLButtonElement;
    const detailToggle = document.getElementById('toggle-detail') as HTMLButtonElement;
    filtersEl.classList.toggle('collapsed', filtersCollapsed);
    detailEl.classList.toggle('collapsed', detailCollapsed);
    filtersToggle.textContent = filtersCollapsed ? '»' : '«';
    filtersToggle.title = filtersCollapsed ? 'Expandir filtros' : 'Colapsar filtros';
    detailToggle.textContent = detailCollapsed ? '«' : '»';
    detailToggle.title = detailCollapsed ? 'Expandir panel de detalles' : 'Colapsar panel de detalles';
  }

  function renderWarnBadge(): void {
    const slot = document.getElementById('warn-slot');
    if (!slot) { return; }
    slot.innerHTML = warningCount > 0
      ? `<button class="warn-badge" id="warn-badge" title="Ver alertas del snapshot">⚠ ${warningCount}</button>`
      : '';
    document.getElementById('warn-badge')?.addEventListener('click', toggleWarnings);
  }

  function renderView(): void {
    const { tab } = getState();
    viewEl.classList.toggle('graph-mode', tab === 'graph');
    if (tab === 'resumen') { renderResumen(viewEl); }
    else if (tab === 'skills') { renderSkills(viewEl); }
    else if (tab === 'agents') { renderAgents(viewEl); }
    else if (tab === 'mcp-env') { renderMcpEnv(viewEl); }
    else if (tab === 'scripts') { renderScriptsRegistry(viewEl); }
    else { renderGraph(viewEl); }
  }

  function render(): void {
    renderWarnBadge();
    renderTabs();
    renderFilterControls();
    applyCollapse();
    renderView();
    renderDetail(detailBodyEl);
    const rescan = document.getElementById('btn-rescan') as HTMLButtonElement | null;
    if (rescan) {
      rescan.disabled = !actionsEnabled();
      rescan.title = actionsEnabled() ? 'Re-scanear el harness desde disco' : actionsHint();
    }
    document.getElementById('warn-badge')?.classList.toggle('active', getState().showWarnings);
  }

  searchEl.addEventListener('input', () => setSearch(searchEl.value));
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== searchEl) {
      event.preventDefault();
      searchEl.focus();
    }
    if (event.key === 'Escape' && document.activeElement === searchEl) {
      searchEl.blur();
    }
  });

  document.getElementById('toggle-filters')?.addEventListener('click', () => {
    setFiltersCollapsed(!getState().filtersCollapsed);
    resizeGraph();
  });
  document.getElementById('toggle-detail')?.addEventListener('click', () => {
    setDetailCollapsed(!getState().detailCollapsed);
    resizeGraph();
  });
  document.getElementById('btn-rescan')?.addEventListener('click', () => {
    void refreshSnapshot();
  });
  window.addEventListener('resize', resizeGraph);

  subscribe(render);
  startOnlineTransport();
  subscribe(renderFreshness); // the online shell starts empty — refresh the "Esperando motor…" text on every change
  render();
  renderFreshness();
  window.setInterval(renderFreshness, 60_000);
}

function renderConnBadge(status: TransportStatus): void {
  const badge = document.getElementById('conn-badge');
  if (badge) {
    badge.hidden = false;
    badge.textContent = CONN_TEXT[status];
    badge.className = `conn-badge ${CONN_TONE[status]}`;
  }
  const banner = document.getElementById('conn-banner');
  if (banner) { banner.hidden = status !== 'offline'; }
}

/**
 * Online boot: swap the API seam for the E2E WebSocket transport, light up the badge, and pull
 * the engine snapshot on every (re)connect — the online bundle embeds an empty shell. The code
 * lives only in the URL fragment, never in localStorage: browsers never transmit fragments, and
 * the URL itself already survives reloads (closing the tab forgets the session).
 */
function startOnlineTransport(): void {
  const code = parseCodeFromHash(window.location.hash);
  if (code === null) { return; } // detectMode already validated — defensive
  const transport = new WSTransport({
    relayUrl: relayOverride(window.location.search) ?? RELAY_URL,
    code,
    onStatus: (status) => {
      renderConnBadge(status);
      notify();
      if (status === 'online') { void refreshSnapshot({ silent: true }); }
    },
    onAgentPresence: (present) => {
      // Agent (re)joined the room → pull fresh data; the empty shell waits otherwise.
      if (present) { void refreshSnapshot({ silent: true }); }
    },
  });
  enableOnlineMode(transport);
  renderConnBadge(transport.status);
}

/**
 * Boot WITH a `#c=` fragment (every origin, spec 2026-10-12): probe the room before mounting
 * the dashboard. A dead session (agent gone, expired room) must fall back to the launcher
 * screen — same code, so `bun agent.ts <CODE>` rejoins the room — instead of an empty
 * "Esperando motor…" dashboard.
 */
async function resumeOnlineSession(): Promise<void> {
  const app = document.getElementById('app');
  if (app) { app.innerHTML = '<div class="pairing"><p class="pairing-hint">Reconectando tu sesión…</p></div>'; }
  const code = parseCodeFromHash(window.location.hash);
  if (code === null) { bootApp(); return; } // detectMode already validated — defensive
  const probe = new WSTransport({ relayUrl: relayOverride(window.location.search) ?? RELAY_URL, code });
  let status: AgentStatus | null = null;
  try {
    status = await waitForAgent(probe, { probeTimeoutMs: 3000, probeIntervalMs: 1500, maxAttempts: 3 });
  }
  finally {
    probe.close();
  }
  if (status?.state === 'running') { bootApp(); }
  else { renderLauncherScreen(() => { bootApp(); }); } // picker state or dead room → launcher (same #c=)
}

// Boot dispatch — ONE set of rules for every origin (spec 2026-10-12): without a valid #c=
// fragment the launcher screen owns the flow (site-generated code, bootstrap command, web
// picker — spec 2026-10-11); with a #c= fragment the agent is probed first so dead sessions
// fall back to the launcher instead of a zombie dashboard.
if (detectMode(window.location.hash) === 'online-unpaired') {
  renderLauncherScreen(() => { bootApp(); });
}
else {
  void resumeOnlineSession();
}
