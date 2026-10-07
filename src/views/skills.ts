import type { SkillEl } from '../types.ts';
import { escapeHtml } from '../components/detail-panel.ts';
import { commandMatches, commands, skillMatches, skills } from '../model.ts';
import { getState, select } from '../state.ts';

type SkillSortKey = 'name' | 'tier' | 'refs' | 'evals' | 'registered' | 'estado';

interface SkillSort {
  key: SkillSortKey
  dir: 'asc' | 'desc'
}

let sort: SkillSort | null = null;

function estadoOf(skill: SkillEl): string {
  if (skill.registered) { return 'registrado'; }
  if (skill.vendored) { return 'vendored'; }
  return 'sin registrar';
}

function estadoChip(skill: SkillEl): string {
  const cls = skill.registered ? 'done' : skill.vendored ? 'indeterminate' : 'todo';
  return `<span class="chip ${cls}">${estadoOf(skill)}</span>`;
}

function sortTh(key: SkillSortKey, label: string): string {
  const active = sort?.key === key;
  const arrow = active ? (sort?.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return `<th${active ? ' class="sorted"' : ''} data-col="${key}" title="Ordenar por ${escapeHtml(label)}">${escapeHtml(label)}${arrow}</th>`;
}

function compareSkills(a: SkillEl, b: SkillEl): number {
  if (!sort) { return a.name.localeCompare(b.name); }
  const dir = sort.dir === 'asc' ? 1 : -1;
  let diff = 0;
  switch (sort.key) {
    case 'name':
      diff = a.name.localeCompare(b.name);
      break;
    case 'tier':
      diff = a.tier.localeCompare(b.tier);
      break;
    case 'refs':
      diff = a.refs.length - b.refs.length;
      break;
    case 'evals':
      diff = Number(a.evals) - Number(b.evals);
      break;
    case 'registered':
      diff = Number(a.registered) - Number(b.registered);
      break;
    case 'estado':
      diff = estadoOf(a).localeCompare(estadoOf(b));
      break;
  }
  if (diff !== 0) { return diff * dir; }
  return a.name.localeCompare(b.name);
}

function skillRow(skill: SkillEl): string {
  const selected = getState().selectedId === skill.id ? ' class="selected"' : '';
  return `
    <tr${selected} data-select="${escapeHtml(skill.id)}">
      <td><span class="rowkey">${escapeHtml(skill.name)}</span> <span class="rowsummary" title="${escapeHtml(skill.path)}">${escapeHtml(skill.path)}</span></td>
      <td><span class="chip">${skill.tier}</span></td>
      <td class="count">${skill.refs.length}</td>
      <td class="count">${skill.evals ? '<span class="ok">✓</span>' : '<span class="muted">·</span>'}</td>
      <td>${skill.registered ? '<span class="ok">✓</span>' : '<span class="muted">·</span>'}</td>
      <td>${estadoChip(skill)}</td>
    </tr>`;
}

export function renderSkills(container: HTMLElement): void {
  const state = getState();
  const visibleSkills = skills.filter(skill => skillMatches(skill, state)).sort(compareSkills);
  const visibleCommands = commands.filter(command => commandMatches(command, state));

  const skillRows = visibleSkills.map(skillRow).join('');
  const commandRows = visibleCommands.map(command => `
    <tr data-select="${escapeHtml(command.id)}">
      <td class="rowkey">${escapeHtml(command.name)}</td>
      <td class="rowsummary" title="${escapeHtml(command.description)}">${escapeHtml(command.description)}</td>
    </tr>`).join('');

  container.innerHTML = `
    <div class="summary-line">
      ${visibleSkills.length} de ${skills.length} skills · click en cabecera = ordenar (asc/desc) · filas seleccionables
    </div>
    ${skillRows
      ? `<div class="matrix-wrap"><table class="matrix">
          <thead><tr>${sortTh('name', 'Skill')}${sortTh('tier', 'Tier')}${sortTh('refs', 'Refs')}${sortTh('evals', 'Evals')}${sortTh('registered', 'Registrado')}${sortTh('estado', 'Estado')}</tr></thead>
          <tbody>${skillRows}</tbody>
        </table></div>`
      : '<div class="empty">Ningún skill coincide con la búsqueda o los filtros</div>'}
    <h3 class="section-title">Comandos<span class="count-pill">${visibleCommands.length}</span></h3>
    ${commandRows
      ? `<div class="matrix-wrap" style="max-height:280px;"><table class="matrix">
          <thead><tr><th>Comando</th><th>Descripción</th></tr></thead>
          <tbody>${commandRows}</tbody>
        </table></div>`
      : '<div class="empty">Sin comandos en este snapshot</div>'}
  `;

  container.querySelectorAll<HTMLTableRowElement>('tr[data-select]').forEach((row) => {
    row.addEventListener('click', () => select(row.dataset.select ?? null));
  });
  container.querySelectorAll<HTMLTableCellElement>('th[data-col]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.col as SkillSortKey;
      if (sort && sort.key === key) {
        sort = { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
      }
      else {
        sort = { key, dir: 'asc' };
      }
      renderSkills(container);
    });
  });
}
