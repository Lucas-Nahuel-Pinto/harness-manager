import type { ElementRef } from '../model.ts';
import { envId, meta, resolveElement } from '../model.ts';
import { getState } from '../state.ts';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const KIND_LABELS: Record<ElementRef['kind'], string> = {
  skill: 'Skill',
  command: 'Comando',
  agent: 'Agente',
  mcp: 'MCP',
  env: 'Variable de entorno',
  script: 'Script',
  registry: 'Registro',
};

function row(label: string, value: string): string {
  return `<div class="row"><span class="label">${escapeHtml(label)}</span><span class="value">${value}</span></div>`;
}

function textRow(label: string, value: string | null | undefined): string {
  return row(label, escapeHtml(value || '—'));
}

function boolRow(label: string, value: boolean): string {
  return row(label, `<span class="${value ? 'ok' : 'bad'}">${value ? 'sí' : 'no'}</span>`);
}

function chipsBlock(label: string, items: string[]): string {
  if (items.length === 0) { return ''; }
  const chips = items.map(item => `<span class="chip">${escapeHtml(item)}</span>`).join('');
  return `
    <div class="chips-block">
      <h3>${escapeHtml(label)}<span class="count-pill">${items.length}</span></h3>
      <div class="chip-row">${chips}</div>
    </div>`;
}

async function copyPath(fullPath: string, button: HTMLButtonElement): Promise<void> {
  try {
    if (!navigator.clipboard) { throw new Error('clipboard unavailable'); }
    await navigator.clipboard.writeText(fullPath);
    button.textContent = 'copiado';
  }
  catch {
    button.textContent = 'no se pudo copiar';
  }
  window.setTimeout(() => { button.textContent = 'Copiar ruta'; }, 1500);
}

function renderElement(ref: ElementRef): string {
  const rows: string[] = [];
  const blocks: string[] = [];
  let path: string | null = null;
  let description = '';

  switch (ref.kind) {
    case 'skill': {
      const skill = ref.element;
      path = skill.path;
      description = skill.description;
      rows.push(row('Tier', `<span class="chip">${skill.tier}</span>`));
      rows.push(boolRow('Registrado', skill.registered));
      rows.push(boolRow('Vendored', skill.vendored));
      rows.push(boolRow('Evals', skill.evals));
      blocks.push(chipsBlock('Triggers', skill.triggers));
      blocks.push(chipsBlock('Refs', skill.refs));
      blocks.push(chipsBlock('Scripts', skill.scripts));
      break;
    }
    case 'command': {
      const command = ref.element;
      path = command.path;
      description = command.description;
      break;
    }
    case 'agent': {
      const agent = ref.element;
      path = agent.path;
      description = agent.description;
      rows.push(textRow('Host', agent.host));
      rows.push(row('Modelo', agent.model
        ? `<span class="chip model">${escapeHtml(agent.model)}</span>`
        : '<span class="chip warn">sin modelo</span>'));
      rows.push(textRow('Modo', agent.mode));
      rows.push(boolRow('Principal', agent.isMain));
      break;
    }
    case 'mcp': {
      const mcp = ref.element;
      rows.push(textRow('Archivo', mcp.configFile));
      rows.push(row('Habilitado', mcp.enabled
        ? '<span class="chip done">activo</span>'
        : '<span class="chip todo">inactivo</span>'));
      blocks.push(chipsBlock('Env refs', mcp.envRefs));
      break;
    }
    case 'env': {
      const envVar = ref.element;
      rows.push(row('.env.example', envVar.inExample
        ? '<span class="chip done">presente</span>'
        : '<span class="chip todo">ausente</span>'));
      rows.push(row('.env', envVar.inEnv
        ? '<span class="chip done">presente</span>'
        : '<span class="chip todo">ausente</span>'));
      break;
    }
    case 'script': {
      rows.push(row('Comando', `<code class="mono">${escapeHtml(ref.element.command)}</code>`));
      break;
    }
    case 'registry': {
      const registry = ref.element;
      path = registry.path;
      rows.push(textRow('Tipo', registry.kind));
      rows.push(row('Entradas', `<span class="mono">${registry.entries}</span>`));
      rows.push(row('Estado', registry.stale === true
        ? '<span class="chip indeterminate">desactualizado</span>'
        : registry.stale === false
          ? '<span class="chip done">actualizado</span>'
          : '<span class="chip todo">sin verificar</span>'));
      break;
    }
  }

  const pathBlock = path
    ? `<div class="path-row"><code>${escapeHtml(path)}</code><button class="copy-btn" data-path="${escapeHtml(path)}">Copiar ruta</button></div>`
    : '';
  const descriptionBlock = description ? `<div class="desc">${escapeHtml(description)}</div>` : '';
  const id = ref.kind === 'env' ? envId(ref.element.name) : ref.element.id;

  return `
    <div class="kind">${KIND_LABELS[ref.kind]}</div>
    <h2>${escapeHtml(ref.element.name)}</h2>
    <div class="key">${escapeHtml(id)}</div>
    ${rows.join('')}
    ${pathBlock}
    ${descriptionBlock}
    ${blocks.filter(Boolean).join('')}
  `;
}

/** Lightweight sheet for graph aux nodes without a snapshot record (e.g. env vars no longer scanned). */
function renderAuxFallback(id: string): string {
  const separator = id.indexOf(':');
  const prefix = separator === -1 ? id : id.slice(0, separator);
  const rest = separator === -1 ? id : id.slice(separator + 1);
  const name = rest.includes('/') ? (rest.split('/').pop() ?? rest) : rest;
  const labels: Record<string, string> = { ref: 'Referencia', env: 'Variable de entorno', registry: 'Registro' };
  return `
    <div class="kind">${escapeHtml(labels[prefix] ?? 'Nodo del grafo')}</div>
    <h2>${escapeHtml(name)}</h2>
    <div class="key">${escapeHtml(id)}</div>
    <div class="desc">Nodo auxiliar del grafo sin ficha propia en el snapshot.</div>
  `;
}

function renderWarnings(): string {
  const items = meta.warnings
    .map(warning => `<div class="warning-row">${escapeHtml(warning)}</div>`)
    .join('');
  return `
    <div class="kind">Alertas del snapshot</div>
    <h2>Alertas <span class="count-pill">${meta.warnings.length}</span></h2>
    <div class="warning-list">${items || '<div class="empty">Sin alertas</div>'}</div>
  `;
}

export function renderDetail(container: HTMLElement): void {
  const state = getState();
  if (state.showWarnings) {
    container.innerHTML = renderWarnings();
    return;
  }
  const ref = resolveElement(state.selectedId);
  if (!ref) {
    container.innerHTML = state.selectedId
      ? renderAuxFallback(state.selectedId)
      : '<div class="empty">Seleccione un elemento para ver su detalle.</div>';
    return;
  }
  container.innerHTML = renderElement(ref);
  container.querySelectorAll<HTMLButtonElement>('.copy-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const fullPath = `${meta.root}/${button.dataset.path ?? ''}`;
      void copyPath(fullPath, button);
    });
  });
}
