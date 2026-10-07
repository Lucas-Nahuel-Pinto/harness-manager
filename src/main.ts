import type { EnvStatus, TabId } from './state.ts';
import type { SkillTier } from './types.ts';
import { escapeHtml, renderDetail } from './components/detail-panel.ts';
import { agentHosts, mcpConfigFiles, meta, warningCount } from './model.ts';
import {
  getState,
  setDetailCollapsed,
  setEnvStatus,
  setFiltersCollapsed,
  setSearch,
  setTab,
  subscribe,
  toggleFlag,
  toggleHost,
  toggleMcpConfig,
  toggleTier,
  toggleWarnings,
} from './state.ts';
import { injectStyles } from './styles.ts';
import { renderAgents } from './views/agents.ts';
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

injectStyles();

const app = document.getElementById('app') as HTMLElement;
app.innerHTML = `
  <header class="topbar">
    <h1>Harness Manager</h1>
    <span class="meta root" title="${escapeHtml(meta.root)}">${escapeHtml(meta.root)}</span>
    <span class="meta" id="freshness"></span>
    <span class="spacer"></span>
    ${warningCount > 0
      ? `<button class="warn-badge" id="warn-badge" title="Ver alertas del snapshot">⚠ ${warningCount}</button>`
      : ''}
    <span class="badge-ro">modo solo lectura</span>
  </header>
  <nav class="tabs" id="tabs"></nav>
  <div class="workspace">
    <nav class="filters" id="filters">
      <button class="panel-toggle" id="toggle-filters" title="Colapsar filtros">«</button>
      <span class="search-label">Buscar</span>
      <input id="search" class="search" type="search" placeholder="nombre, ruta o descripción (/)" autocomplete="off" />
      <div id="filter-controls"></div>
      <div class="filter-actions">
        <button class="action" disabled title="Requiere serve (Fase 5)">Re-scan</button>
        <button class="action" disabled title="Correr bun run build en terminal">Build</button>
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
    const graph = id === 'graph' ? ' disabled' : '';
    const title = id === 'graph' ? ' title="Disponible en Fase 4"' : '';
    return `<button class="tab${active}${graph}" data-tab="${id}"${title}>${label}</button>`;
  }).join('');
  tabsEl.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.tab as TabId));
  });
}

function checkItem(filter: string, value: string, checked: boolean, label: string): string {
  return `<label class="filter-item"><input type="checkbox" data-filter="${filter}" value="${escapeHtml(value)}"${checked ? ' checked' : ''} />${escapeHtml(label)}</label>`;
}

function radioItem(value: string, checked: boolean, label: string): string {
  return `<label class="filter-item"><input type="radio" name="env-status" data-filter="env" value="${value}"${checked ? ' checked' : ''} />${escapeHtml(label)}</label>`;
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

function renderView(): void {
  const { tab } = getState();
  if (tab === 'resumen') { renderResumen(viewEl); }
  else if (tab === 'skills') { renderSkills(viewEl); }
  else if (tab === 'agents') { renderAgents(viewEl); }
  else if (tab === 'mcp-env') { renderMcpEnv(viewEl); }
  else if (tab === 'scripts') { renderScriptsRegistry(viewEl); }
  else {
    viewEl.innerHTML = `
      <div class="placeholder-tab">
        <h2>Grafo</h2>
        <p>Disponible en Fase 4</p>
      </div>`;
  }
}

function render(): void {
  renderTabs();
  renderFilterControls();
  applyCollapse();
  renderView();
  renderDetail(detailBodyEl);
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
});
document.getElementById('toggle-detail')?.addEventListener('click', () => {
  setDetailCollapsed(!getState().detailCollapsed);
});
document.getElementById('warn-badge')?.addEventListener('click', toggleWarnings);

subscribe(render);
render();
renderFreshness();
window.setInterval(renderFreshness, 60_000);
