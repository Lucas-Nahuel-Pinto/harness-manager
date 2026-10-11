import type { AgentEl } from '../types.ts';
import { escapeHtml } from '../components/detail-panel.ts';
import { agentMatches, agents, catalogModels } from '../model.ts';
import { runStagedAction } from '../refresh.ts';
import { actionsEnabled, actionsHint } from '../serve.ts';
import { getState, select } from '../state.ts';

function modelChip(agent: AgentEl): string {
  return agent.model
    ? `<span class="chip model">${escapeHtml(agent.model)}</span>`
    : '<span class="chip warn">sin modelo</span>';
}

/** Model becomes a catalog-backed select (server re-validates on apply). */
function modelCell(agent: AgentEl): string {
  const options = catalogModels.map(model => model.id);
  if (agent.model && !options.includes(agent.model)) { options.push(agent.model); }
  if (options.length === 0) { return modelChip(agent); }
  const canAct = actionsEnabled();
  const selectHtml = options.map((id) => {
    const selected = id === agent.model ? ' selected' : '';
    return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(id)}</option>`;
  }).join('');
  const disabled = canAct ? '' : ' disabled';
  const title = canAct ? 'Asignar modelo del agente (catálogo)' : actionsHint();
  return `<select class="model-select" data-agent-model="${escapeHtml(agent.id)}" title="${escapeHtml(title)}"${disabled}>${selectHtml}</select>`;
}

export function renderAgents(container: HTMLElement): void {
  const state = getState();
  const visible = agents
    .filter(agent => agentMatches(agent, state))
    .sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name));

  const rows = visible.map((agent) => {
    const mainCell = agent.isMain ? '<span class="chip accent">principal</span>' : '<span class="muted">·</span>';
    const classes = agent.isMain ? ' class="main-row"' : '';
    return `
      <tr${classes} data-select="${escapeHtml(agent.id)}">
        <td><span class="rowkey">${escapeHtml(agent.name)}</span> <span class="rowsummary" title="${escapeHtml(agent.path)}">${escapeHtml(agent.path)}</span></td>
        <td><span class="chip">${escapeHtml(agent.host)}</span></td>
        <td>${modelCell(agent)}</td>
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
  container.querySelectorAll<HTMLSelectElement>('[data-agent-model]').forEach((selectEl) => {
    selectEl.addEventListener('click', event => event.stopPropagation());
    selectEl.addEventListener('change', () => {
      void runStagedAction(
        { kind: 'model-set', payload: { agentId: selectEl.dataset.agentModel, model: selectEl.value } },
        'Asignar modelo',
      );
    });
  });
}
