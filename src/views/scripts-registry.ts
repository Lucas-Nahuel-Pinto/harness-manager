import { escapeHtml } from '../components/detail-panel.ts';
import { registries, registryMatches, scriptMatches, scripts } from '../model.ts';
import { runScriptByName } from '../refresh.ts';
import { isServeMode } from '../serve.ts';
import { getState, select } from '../state.ts';

const REGISTRY_LABELS: Record<string, string> = {
  'skill-registry': 'registro de skills',
  'kata-manifest': 'kata manifest',
  'models-catalog': 'catálogo de modelos',
};

export function renderScriptsRegistry(container: HTMLElement): void {
  const state = getState();
  const visibleScripts = scripts.filter(script => scriptMatches(script, state));
  const visibleRegistries = registries.filter(registry => registryMatches(registry, state));

  const scriptRows = visibleScripts.map((script) => {
    const runBtn = isServeMode
      ? `<button class="action run-btn" data-run="${escapeHtml(script.name)}" title="Ejecuta bun run ${escapeHtml(script.name)} en el harness (30s máximo)">Correr</button>`
      : '<span class="muted">—</span>';
    return `
    <tr data-select="${escapeHtml(script.id)}">
      <td class="rowkey">${escapeHtml(script.name)}</td>
      <td class="cmd" title="${escapeHtml(script.command)}">${escapeHtml(script.command)}</td>
      <td>${runBtn}</td>
    </tr>`;
  }).join('');

  const registryCards = visibleRegistries.map((registry) => {
    const staleChip = registry.stale === true
      ? '<span class="chip indeterminate">desactualizado</span>'
      : '';
    return `
      <button class="reg-card" data-select="${escapeHtml(registry.id)}">
        <span class="card-head">
          <span class="card-title">${escapeHtml(registry.name)}</span>
          <span class="chip">${escapeHtml(REGISTRY_LABELS[registry.kind] ?? registry.kind)}</span>
        </span>
        <span class="reg-entries">${registry.entries} entradas ${staleChip}</span>
      </button>`;
  }).join('');

  container.innerHTML = `
    <h3 class="section-title">Scripts<span class="count-pill">${visibleScripts.length}</span></h3>
    ${scriptRows
      ? `<div class="matrix-wrap" style="max-height:320px;"><table class="matrix">
          <thead><tr><th>Nombre</th><th>Comando</th><th>Acción</th></tr></thead>
          <tbody>${scriptRows}</tbody>
        </table></div>`
      : '<div class="empty">Sin scripts en este snapshot</div>'}
    <h3 class="section-title">Registros<span class="count-pill">${visibleRegistries.length}</span></h3>
    ${registryCards
      ? `<div class="card-grid">${registryCards}</div>`
      : '<div class="empty">Sin registros en este snapshot</div>'}
  `;

  container.querySelectorAll<HTMLElement>('[data-select]').forEach((element) => {
    element.addEventListener('click', () => select(element.dataset.select ?? null));
  });
  container.querySelectorAll<HTMLButtonElement>('[data-run]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void runScriptByName(button.dataset.run ?? '');
    });
  });
}
