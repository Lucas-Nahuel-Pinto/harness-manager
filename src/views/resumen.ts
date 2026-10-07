import { escapeHtml } from '../components/detail-panel.ts';
import { health, healthRollup, meta, staleRegistries, totals, warningCount } from '../model.ts';
import { getState, select } from '../state.ts';

function kpiCard(label: string, value: number): string {
  return `<div class="kpi-card"><span class="kpi-value">${value}</span><span class="kpi-label">${escapeHtml(label)}</span></div>`;
}

function mark(ok: boolean): string {
  return ok ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>';
}

function healthCard(section: 'docs' | 'ci' | 'tests', letter: string, title: string, ok: boolean, lines: string[]): string {
  const id = `health:${section}`;
  const selected = getState().selectedId === id;
  return `
    <div class="health-card clickable${selected ? ' selected' : ''}" data-health="${section}" title="Ver detalle en el panel de la derecha">
      <div class="health-head"><span class="dot ${ok ? 'ok' : 'bad'}"></span>${letter} · ${escapeHtml(title)}</div>
      ${lines.map(line => `<div class="health-line">${line}</div>`).join('')}
      <div class="health-line muted">ver detalle →</div>
    </div>`;
}

export function renderResumen(container: HTMLElement): void {
  const warnings = meta.warnings
    .map(warning => `<div class="warning-row">${escapeHtml(warning)}</div>`)
    .join('');

  container.innerHTML = `
    <div class="summary-line">
      snapshot ${meta.scannedAt.slice(0, 16).replace('T', ' ')} · tool v${escapeHtml(meta.toolVersion)} ·
      raíz <span class="mono" title="${escapeHtml(meta.root)}">${escapeHtml(meta.root)}</span> ·
      manifest ${meta.manifest ? 'sí' : 'no'}
    </div>
    <div class="kpi-grid">
      ${kpiCard('Skills', totals.skills)}
      ${kpiCard('Comandos', totals.commands)}
      ${kpiCard('Agentes', totals.agents)}
      ${kpiCard('MCPs', totals.mcps)}
      ${kpiCard('Env vars', totals.env)}
      ${kpiCard('Scripts', totals.scripts)}
      ${kpiCard('Registros', totals.registries)}
    </div>
    <h3 class="section-title">Columnas de salud</h3>
    <div class="health-grid">
      ${healthCard('docs', 'H', 'Documentos', healthRollup.docs, [
        `AGENTS.md ${mark(health.docs.agentsMd)}`,
        `README.md ${mark(health.docs.readme)}`,
      ])}
      ${healthCard('ci', 'I', 'CI', healthRollup.ci, [
        `Workflows: <span class="mono">${health.ci.workflows.length}</span> ${health.ci.workflows.map(w => `<span class="chip">${escapeHtml(w)}</span>`).join(' ') || '<span class="muted">ninguno</span>'}`,
        `Husky ${mark(health.ci.husky)}`,
      ])}
      ${healthCard('tests', 'J', 'Tests y gates', healthRollup.tests, [
        `test ${mark(health.tests.testScript)} · lint ${mark(health.tests.lintScript)} · types ${mark(health.tests.typesScript)}`,
        `Registros desactualizados: <span class="${staleRegistries.length > 0 ? 'bad' : 'ok'}">${staleRegistries.length}</span>`,
        `Alertas del snapshot: <span class="${warningCount > 0 ? 'bad' : 'ok'}">${warningCount}</span>`,
      ])}
    </div>
    ${warningCount > 0
      ? `<h3 class="section-title">Alertas<span class="count-pill">${warningCount}</span></h3>
         <div class="warning-list">${warnings}</div>`
      : ''}
  `;

  container.querySelectorAll<HTMLElement>('[data-health]').forEach((card) => {
    card.addEventListener('click', () => select(`health:${card.dataset.health}`));
  });
}
