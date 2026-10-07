import { escapeHtml } from '../components/detail-panel.ts';
import { agentMatches, agents } from '../model.ts';
import { getState, select } from '../state.ts';

export function renderAgents(container: HTMLElement): void {
  const state = getState();
  const visible = agents
    .filter(agent => agentMatches(agent, state))
    .sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name));

  const rows = visible.map((agent) => {
    const modelCell = agent.model
      ? `<span class="chip model">${escapeHtml(agent.model)}</span>`
      : '<span class="chip warn">sin modelo</span>';
    const mainCell = agent.isMain ? '<span class="chip accent">principal</span>' : '<span class="muted">·</span>';
    const classes = agent.isMain ? ' class="main-row"' : '';
    return `
      <tr${classes} data-select="${escapeHtml(agent.id)}">
        <td><span class="rowkey">${escapeHtml(agent.name)}</span> <span class="rowsummary" title="${escapeHtml(agent.path)}">${escapeHtml(agent.path)}</span></td>
        <td><span class="chip">${escapeHtml(agent.host)}</span></td>
        <td>${modelCell}</td>
        <td>${agent.mode ? escapeHtml(agent.mode) : '<span class="muted">—</span>'}</td>
        <td>${mainCell}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="summary-line">${visible.length} de ${agents.length} agentes · el principal va primero</div>
    ${rows
      ? `<div class="matrix-wrap"><table class="matrix">
          <thead><tr><th>Agente</th><th>Host</th><th>Modelo</th><th>Modo</th><th>Principal</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`
      : '<div class="empty">Sin agentes en este snapshot</div>'}
  `;

  container.querySelectorAll<HTMLTableRowElement>('tr[data-select]').forEach((row) => {
    row.addEventListener('click', () => select(row.dataset.select ?? null));
  });
}
