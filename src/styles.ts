export const styles = `
:root {
  --bg: #0d1117;
  --panel: #161b24;
  --panel-2: #1c2230;
  --border: #2a3243;
  --text: #dbe2ee;
  --muted: #8b94a7;
  --accent: #9ecbff;
  --green: #3fb950;
  --red: #f85149;
  --amber: #d29922;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif;
}
#app { display: flex; flex-direction: column; height: 100vh; }
.topbar {
  display: flex; align-items: center; gap: 14px;
  padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--border);
}
.topbar h1 { font-size: 15px; margin: 0; font-weight: 600; }
.topbar .meta { color: var(--muted); font-size: 12px; }
.topbar .root {
  max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--mono); font-size: 11.5px;
}
.topbar .spacer { flex: 1; }
.warn-badge {
  background: rgba(210,153,34,0.12); border: 1px solid rgba(210,153,34,0.45);
  color: var(--amber); border-radius: 10px; padding: 2px 9px;
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.warn-badge:hover, .warn-badge.active {
  background: rgba(210,153,34,0.28); border-color: var(--amber); color: #ffd166;
}
.badge-ro {
  display: inline-block; padding: 2px 9px; border-radius: 10px;
  background: var(--panel-2); border: 1px solid var(--border);
  color: var(--muted); font-size: 11px;
}
.tabs { display: flex; gap: 4px; padding: 8px 16px 0; background: var(--panel); border-bottom: 1px solid var(--border); }
.tab {
  background: transparent; border: 1px solid transparent; border-bottom: none;
  color: var(--muted); padding: 7px 14px; border-radius: 7px 7px 0 0; cursor: pointer; font-size: 13px;
}
.tab:hover { color: var(--text); }
.tab.active { background: var(--bg); border-color: var(--border); color: var(--text); }
.tab.disabled { color: #596273; cursor: not-allowed; opacity: 0.75; }
.tab.disabled:hover { color: #596273; }
.workspace { display: flex; flex: 1; min-height: 0; }
.view { flex: 1; overflow: auto; padding: 14px 16px; }
.filters {
  width: 216px; flex: none; border-right: 1px solid var(--border);
  background: var(--panel); overflow: auto; padding: 12px 14px;
}
.filters h4 {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--muted); margin: 14px 0 6px;
}
.filter-item {
  display: flex; gap: 6px; align-items: center; font-size: 12px;
  padding: 2px 0; cursor: pointer; color: var(--text);
}
.filter-item input { accent-color: var(--accent); }
.search-label {
  display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--muted); margin-bottom: 4px;
}
.search {
  width: 100%; background: var(--panel-2); border: 1px solid var(--border);
  color: var(--text); border-radius: 6px; padding: 6px 9px; outline: none; font-size: 12.5px;
}
.search:focus { border-color: var(--accent); }
.filter-note { color: var(--muted); font-size: 12px; font-style: italic; margin-top: 12px; }
.filter-actions { display: flex; gap: 6px; margin-top: 16px; }
.action {
  flex: 1; background: var(--panel-2); border: 1px solid var(--border); color: var(--muted);
  border-radius: 6px; padding: 5px 8px; font-size: 12px; cursor: not-allowed; opacity: 0.7;
}
.panel-toggle {
  display: block; width: 100%; margin-bottom: 8px;
  background: var(--panel-2); border: 1px solid var(--border); color: var(--muted);
  border-radius: 6px; padding: 3px 6px; cursor: pointer; font-size: 12px; line-height: 1.3;
}
.panel-toggle:hover { color: var(--text); border-color: var(--accent); }
.filters.collapsed { width: 34px; padding: 8px 4px; }
.filters.collapsed > :not(.panel-toggle) { display: none; }
.detail {
  width: 360px; border-left: 1px solid var(--border); background: var(--panel);
  overflow: auto; padding: 14px 16px;
}
.detail.collapsed { width: 34px; padding: 8px 4px; }
.detail.collapsed > :not(.panel-toggle) { display: none; }
.detail .kind {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted);
}
.detail h2 { font-size: 15px; margin: 2px 0 4px; }
.detail .key { font-family: var(--mono); color: var(--accent); font-size: 12px; word-break: break-all; }
.detail .desc { color: var(--muted); font-size: 12.5px; margin-top: 8px; }
.detail .row { display: flex; gap: 8px; margin-top: 8px; font-size: 13px; align-items: baseline; }
.detail .row .label { color: var(--muted); width: 108px; flex: none; }
.detail .row .value { min-width: 0; word-break: break-word; }
.detail .path-row {
  display: flex; gap: 8px; align-items: center; margin-top: 10px;
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px;
}
.detail .path-row code {
  font-family: var(--mono); font-size: 11.5px; color: var(--text);
  overflow-wrap: anywhere; flex: 1; min-width: 0;
}
.copy-btn {
  background: var(--bg); border: 1px solid var(--border); color: var(--muted);
  border-radius: 6px; padding: 4px 9px; font-size: 11.5px; cursor: pointer; flex: none;
}
.copy-btn:hover { color: var(--text); border-color: var(--accent); }
.chips-block { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 10px; }
.chips-block h3 {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--muted); margin: 0 0 6px;
}
.chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
.chip {
  display: inline-block; padding: 1px 8px; border-radius: 10px;
  font-size: 11px; background: var(--panel-2); border: 1px solid var(--border); color: var(--muted);
}
.chip.done { color: var(--green); border-color: rgba(63,185,80,0.4); }
.chip.indeterminate { color: var(--amber); border-color: rgba(210,153,34,0.4); }
.chip.todo { color: var(--muted); }
.chip.model { color: var(--accent); border-color: rgba(158,203,255,0.4); font-family: var(--mono); }
.chip.warn { color: var(--amber); border-color: rgba(210,153,34,0.45); }
.chip.accent { color: var(--accent); border-color: rgba(158,203,255,0.45); }
.summary-line { color: var(--muted); font-size: 12px; margin-bottom: 12px; }
.mono { font-family: var(--mono); }
.muted { color: var(--muted); }
.ok { color: var(--green); }
.bad { color: var(--red); }
.section-title { margin: 18px 0 8px; font-size: 13px; font-weight: 600; }
.section-title:first-of-type { margin-top: 0; }
.count-pill {
  display: inline-block; min-width: 20px; padding: 0 6px; margin-left: 8px;
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 9px;
  font-size: 11px; font-weight: 400; color: var(--muted); text-align: center;
}
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 8px; }
.kpi-card {
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 12px; display: flex; flex-direction: column; gap: 2px;
}
.kpi-value { font-family: var(--mono); font-size: 22px; font-weight: 600; color: var(--accent); }
.kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.health-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
.health-card {
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px;
}
.health-card.clickable { cursor: pointer; }
.health-card.clickable:hover { border-color: var(--accent); }
.health-card.selected { border-color: var(--accent); background: rgba(158,203,255,0.07); }
.health-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; margin-bottom: 6px;
}
.health-line { font-size: 12.5px; color: var(--muted); padding: 2px 0; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; display: inline-block; }
.dot.ok { background: var(--green); }
.dot.bad { background: var(--red); }
.dot.warn { background: var(--amber); }
.warning-list { display: flex; flex-direction: column; gap: 5px; }
.warning-row {
  background: var(--panel); border: 1px solid rgba(210,153,34,0.35); border-radius: 6px;
  color: var(--text); padding: 7px 10px; font-size: 12.5px;
}
.matrix-wrap {
  overflow: auto; max-height: calc(100vh - 200px);
  border: 1px solid var(--border); border-radius: 8px; background: var(--panel);
}
table.matrix { border-collapse: collapse; font-size: 12.5px; width: 100%; }
.matrix th, .matrix td { border-bottom: 1px solid var(--border); padding: 6px 9px; white-space: nowrap; }
.matrix th {
  position: sticky; top: 0; background: var(--panel-2); z-index: 1;
  text-align: left; color: var(--muted); font-weight: 600;
}
.matrix th[data-col] { cursor: pointer; user-select: none; }
.matrix th[data-col]:hover { color: var(--text); }
.matrix th.sorted { color: var(--accent); }
.matrix td.count { text-align: right; font-family: var(--mono); }
.matrix td.dot-cell { text-align: center; }
.matrix tbody tr { cursor: pointer; }
.matrix tbody tr:hover td { background: var(--panel-2); }
.matrix .rowkey { font-family: var(--mono); color: var(--accent); }
.matrix .rowsummary {
  color: var(--muted); max-width: 340px; overflow: hidden; text-overflow: ellipsis;
  display: inline-block; vertical-align: bottom;
}
.matrix .cmd {
  font-family: var(--mono); font-size: 11.5px; color: var(--text);
  max-width: 460px; overflow: hidden; text-overflow: ellipsis;
}
.matrix tr.main-row td { background: rgba(158,203,255,0.07); }
.matrix tr.main-row:hover td { background: rgba(158,203,255,0.12); }
.matrix tr.selected td { background: rgba(158,203,255,0.14); }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
.mcp-card, .reg-card {
  display: flex; flex-direction: column; gap: 6px; align-items: flex-start; text-align: left;
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 12px; cursor: pointer; color: var(--text); font-size: 13px; width: 100%;
}
.mcp-card:hover, .reg-card:hover { border-color: var(--accent); }
.card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width: 100%; }
.card-title { font-weight: 600; font-family: var(--mono); }
.card-sub { display: flex; flex-wrap: wrap; gap: 4px; min-height: 18px; }
.reg-entries { font-size: 12px; color: var(--muted); }
.legend {
  display: flex; flex-wrap: wrap; gap: 14px; align-items: center;
  color: var(--muted); font-size: 11.5px; margin-top: 8px;
}
.legend .dot { margin-right: 4px; }
.view.graph-mode { display: flex; flex-direction: column; padding: 10px; overflow: hidden; }
.graph-wrap {
  flex: 1; min-height: 480px; border: 1px solid var(--border);
  border-radius: 8px; overflow: hidden; position: relative; background: var(--panel);
}
.graph-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(15, 18, 24, 0.82); color: var(--muted); font-size: 13px; z-index: 5;
}
.graph-legend {
  position: absolute; left: 10px; bottom: 8px; z-index: 4;
  display: flex; flex-wrap: wrap; gap: 10px;
  background: rgba(22, 27, 36, 0.85); border: 1px solid var(--border);
  border-radius: 6px; padding: 5px 9px;
}
.graph-legend .item {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; color: var(--muted);
}
.empty { color: var(--muted); padding: 14px; font-style: italic; }
.toasts {
  position: fixed; right: 16px; bottom: 16px; z-index: 50;
  display: flex; flex-direction: column; gap: 6px; pointer-events: none;
}
.toast {
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); padding: 8px 12px; font-size: 12.5px; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.toast.error { border-color: rgba(248,81,73,0.6); }

/* ── Fase 5: serve mode (acciones) ─────────────────────────── */
.badge-ro.serve { color: var(--green); border-color: rgba(63,185,80,0.45); }
.action:not(:disabled) {
  cursor: pointer; opacity: 1; color: var(--text);
  background: var(--panel-2); border-color: var(--border);
}
.action:not(:disabled):hover { border-color: var(--accent); color: var(--accent); }
.action:disabled { cursor: not-allowed; }
.mcp-cell { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.mcp-actions { display: flex; gap: 6px; align-items: center; }
.mcp-toggle { flex: 1; }
.mcp-hint {
  font-size: 10.5px; color: var(--amber); line-height: 1.35; cursor: help;
}
.mcp-hint code { font-family: var(--mono); font-size: 10px; }
.run-btn { flex: none; padding: 3px 10px; font-size: 11.5px; }
.model-select {
  background: var(--panel-2); border: 1px solid var(--border); color: var(--text);
  border-radius: 6px; padding: 2px 6px; font-size: 11.5px; max-width: 190px;
  font-family: var(--mono);
}
.model-select:focus { border-color: var(--accent); outline: none; }

.modal-overlay {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
}
.modal {
  background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
  width: min(780px, 92vw); max-height: 84vh;
  display: flex; flex-direction: column;
  padding: 14px 16px; box-shadow: 0 12px 40px rgba(0,0,0,0.5);
}
.modal-title { margin: 0 0 6px; font-size: 14px; }
.modal-summary { color: var(--muted); font-size: 12.5px; margin-bottom: 8px; }
.modal-body { overflow: auto; min-height: 0; }
.modal-diff {
  font-family: var(--mono); font-size: 11.5px; line-height: 1.5;
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 8px 10px; overflow: auto; white-space: pre; margin: 0; color: var(--text);
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.modal-confirm {
  background: var(--accent); color: #0b1220; border: none; border-radius: 6px;
  padding: 6px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer;
}
.modal-confirm:hover { filter: brightness(1.1); }
.modal-cancel {
  background: var(--panel-2); border: 1px solid var(--border); color: var(--text);
  border-radius: 6px; padding: 6px 14px; font-size: 12.5px; cursor: pointer;
}
.modal-cancel:hover { border-color: var(--accent); }
.server-ctl { display: inline-flex; align-items: center; gap: 7px; margin-right: 10px; }
.server-label { font-size: 11.5px; color: var(--muted); white-space: nowrap; }
.server-ctl .action { font-size: 11.5px; padding: 3px 10px; }
.cmd-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.cmd-row code {
  flex: 1; min-width: 0; font-family: var(--mono); font-size: 11.5px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 6px 8px; overflow-x: auto; white-space: nowrap; color: var(--text);
}
.copy-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.copy-btn:disabled:hover { color: var(--muted); border-color: var(--border); }
`;

export function injectStyles(): void {
  const el = document.createElement('style');
  el.textContent = styles;
  document.head.appendChild(el);
}
