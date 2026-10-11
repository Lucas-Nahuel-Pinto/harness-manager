import { escapeHtml } from '../components/detail-panel.ts';
import { env, envId, envMatches, mcpMatches, mcps } from '../model.ts';
import { runStagedAction } from '../refresh.ts';
import { actionsEnabled, actionsHint } from '../serve.ts';
import { getState, select } from '../state.ts';

const CLAUDE_HINT = 'Claude Code no aplica "enabled" en .mcp.json — el flag solo surte efecto en opencode.jsonc';

export function renderMcpEnv(container: HTMLElement): void {
  const state = getState();
  const visibleMcps = mcps.filter(mcp => mcpMatches(mcp, state));
  const visibleEnv = env.filter(envVar => envMatches(envVar, state));

  const mcpCards = visibleMcps.map((mcp) => {
    const refs = mcp.envRefs.length > 0
      ? mcp.envRefs.map(ref => `<span class="chip">${escapeHtml(ref)}</span>`).join('')
      : '<span class="muted">sin env refs</span>';
    const canAct = actionsEnabled();
    const toggle = `<button class="action mcp-toggle" data-toggle-mcp="${escapeHtml(mcp.id)}"${canAct ? '' : ' disabled'}${canAct ? '' : ` title="${escapeHtml(actionsHint())}"`}>${mcp.enabled ? 'Deshabilitar' : 'Habilitar'}</button>`;
    const hint = mcp.configFile === '.mcp.json'
      ? `<span class="mcp-hint" title="${escapeHtml(CLAUDE_HINT)}">Claude Code no lee <code>enabled</code> aquí</span>`
      : '';
    return `
      <div class="mcp-cell">
        <button class="mcp-card" data-select="${escapeHtml(mcp.id)}">
          <span class="card-head"><span class="card-title">${escapeHtml(mcp.name)}</span><span class="chip">${escapeHtml(mcp.configFile)}</span></span>
          <span class="card-sub">${refs}</span>
        </button>
        ${toggle}${hint}
      </div>`;
  }).join('');

  const envRows = visibleEnv.map((envVar) => {
    const both = envVar.inExample && envVar.inEnv;
    const one = envVar.inExample || envVar.inEnv;
    const estado = both
      ? '<span class="chip done">completa</span>'
      : one
        ? '<span class="chip indeterminate">parcial</span>'
        : '<span class="chip todo">ausente</span>';
    const exampleDot = envVar.inExample ? '<span class="dot ok"></span>' : '<span class="dot bad"></span>';
    const envDot = envVar.inEnv ? '<span class="dot ok"></span>' : '<span class="dot bad"></span>';
    return `
      <tr data-select="${escapeHtml(envId(envVar.name))}">
        <td class="rowkey">${escapeHtml(envVar.name)}</td>
        <td class="dot-cell">${exampleDot}</td>
        <td class="dot-cell">${envDot}</td>
        <td>${estado}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <h3 class="section-title">MCPs<span class="count-pill">${visibleMcps.length}</span></h3>
    ${mcpCards ? `<div class="card-grid">${mcpCards}</div>` : '<div class="empty">Sin MCPs en este snapshot</div>'}
    <h3 class="section-title">Variables de entorno<span class="count-pill">${visibleEnv.length}</span></h3>
    ${envRows
      ? `<div class="matrix-wrap"><table class="matrix">
          <thead><tr><th>Variable</th><th>.env.example</th><th>.env</th><th>Estado</th></tr></thead>
          <tbody>${envRows}</tbody>
        </table></div>
        <div class="legend">
          <span><span class="dot ok"></span> presente</span>
          <span><span class="dot bad"></span> ausente</span>
          <span><span class="chip indeterminate">parcial</span> presente en un solo archivo</span>
        </div>`
      : '<div class="empty">Ninguna variable coincide con la búsqueda o el filtro</div>'}
  `;

  container.querySelectorAll<HTMLElement>('[data-select]').forEach((element) => {
    element.addEventListener('click', () => select(element.dataset.select ?? null));
  });
  container.querySelectorAll<HTMLButtonElement>('[data-toggle-mcp]').forEach((button) => {
    button.addEventListener('click', () => {
      const mcp = mcps.find(entry => entry.id === button.dataset.toggleMcp);
      if (!mcp) { return; }
      void runStagedAction(
        { kind: 'mcp-toggle', payload: { configFile: mcp.configFile, name: mcp.name, enable: !mcp.enabled } },
        `${mcp.enabled ? 'Deshabilitar' : 'Habilitar'} MCP`,
      );
    });
  });
}
