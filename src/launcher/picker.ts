/**
 * PICKER PAGE — standalone HTML served while no harness root is picked (spec §2/§3.4).
 *
 * Same visual language as the dashboard (dark tokens from `src/styles.ts`): recents
 * list (click = POST /api/root), native-dialog button (POST /api/browse), and the
 * universal manual-path fallback. Every interpolated value is HTML-escaped; toasts
 * are set via `textContent`, so no path or server message can inject markup.
 */

import type { RecentEntry } from '../desktop/recents.ts';
import { escapeHtml } from '../html.ts';

/** Distinctive marker — tests assert the picker (not the dashboard) is being served. */
export const PICKER_MARKER = 'id="hm-picker"';

function recentRow(entry: RecentEntry): string {
  const path = escapeHtml(entry.path);
  const when = escapeHtml(new Date(entry.lastUsed).toLocaleString());
  return `<li><button type="button" class="recent" data-path="${path}"><code class="path">${path}</code><span class="when">${when}</span></button></li>`;
}

function recentsSection(recents: RecentEntry[]): string {
  if (recents.length === 0) {
    return '<p class="empty">Todavía no hay harnesses recientes — exponé una ruta abajo.</p>';
  }
  return `<ul class="recents">\n${recents.map(recentRow).join('\n')}\n</ul>`;
}

export function pickerHtml(recents: RecentEntry[]): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>harness-manager — elegir harness</title>
<style>
:root {
  --bg: #0d1117;
  --panel: #161b24;
  --panel-2: #1c2230;
  --border: #2a3243;
  --text: #dbe2ee;
  --muted: #8b94a7;
  --accent: #9ecbff;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { background: var(--bg); color: var(--text); font: 14px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; }
.wrap { max-width: 660px; margin: 10vh auto 0; padding: 0 16px 32px; display: flex; flex-direction: column; gap: 14px; }
h1 { font-size: 18px; margin: 0; }
.sub { color: var(--muted); font-size: 13px; margin: 4px 0 0; }
h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 0 0 8px; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.recents { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.recent {
  display: flex; gap: 10px; align-items: baseline; width: 100%; text-align: left;
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px;
  padding: 7px 10px; color: var(--text); cursor: pointer; font-size: 13px;
}
.recent:hover { border-color: var(--accent); }
.recent .path {
  flex: 1; min-width: 0; font-family: var(--mono); font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.recent .when { color: var(--muted); font-size: 11.5px; flex: none; }
.empty { color: var(--muted); font-style: italic; font-size: 12.5px; margin: 0; }
.row { display: flex; gap: 8px; align-items: center; }
.browse-btn, .use-btn {
  background: var(--panel-2); border: 1px solid var(--border); color: var(--text);
  border-radius: 6px; padding: 7px 14px; font-size: 13px; cursor: pointer; flex: none;
}
.browse-btn:hover, .use-btn:hover { border-color: var(--accent); color: var(--accent); }
.input {
  flex: 1; min-width: 0; background: var(--panel-2); border: 1px solid var(--border);
  color: var(--text); border-radius: 6px; padding: 7px 10px; outline: none;
  font-family: var(--mono); font-size: 12.5px;
}
.input:focus { border-color: var(--accent); }
.toast {
  position: fixed; right: 16px; bottom: 16px; z-index: 50;
  background: var(--panel); border: 1px solid rgba(248,81,73,0.6); border-radius: 8px;
  color: var(--text); padding: 8px 12px; font-size: 12.5px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4); max-width: min(440px, 80vw);
}
</style>
</head>
<body>
<main class="wrap" ${PICKER_MARKER}>
  <div>
    <h1>harness-manager</h1>
    <p class="sub">Elegí el harness a gestionar.</p>
  </div>
  <section class="panel">
    <h2>Recientes</h2>
    ${recentsSection(recents)}
  </section>
  <section class="panel">
    <h2>Otra carpeta</h2>
    <div class="row">
      <button type="button" class="browse-btn" id="browse">Examinar…</button>
      <input class="input" id="root-input" type="text" placeholder="Ruta absoluta del harness" spellcheck="false" autocomplete="off">
      <button type="button" class="use-btn" id="use-path">Usar esta ruta</button>
    </div>
  </section>
</main>
<div id="toast" class="toast" hidden></div>
<script>
(function () {
  var toastEl = document.getElementById('toast');
  var toastTimer;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 4000);
  }
  var busy = false;
  function withBusy(fn) {
    if (busy) { return; }
    busy = true;
    fn().finally(function () { busy = false; });
  }
  function postJson(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (response) {
      return response.json().then(function (data) { return { status: response.status, data: data }; });
    });
  }
  function useRoot(path) {
    return postJson('/api/root', { path: path }).then(function (result) {
      if (result.status === 200 && result.data.ok) { location.reload(); return; }
      toast(result.data.detail || 'No se pudo usar esa ruta.');
    }).catch(function () { toast('El launcher no respondió.'); });
  }
  document.querySelectorAll('.recent').forEach(function (button) {
    button.addEventListener('click', function () { withBusy(function () { return useRoot(button.dataset.path); }); });
  });
  document.getElementById('browse').addEventListener('click', function () {
    withBusy(function () {
      return postJson('/api/browse', {}).then(function (result) {
        if (result.status === 200 && result.data.cancelled) { return; }
        if (result.status === 200 && result.data.path) { return useRoot(result.data.path); }
        if (result.data.error === 'browse_unsupported') { toast('Diálogo no disponible — pegá la ruta abajo.'); return; }
        toast(result.data.detail || 'No se pudo abrir el diálogo de carpetas.');
      }).catch(function () { toast('El launcher no respondió.'); });
    });
  });
  var input = document.getElementById('root-input');
  var useButton = document.getElementById('use-path');
  useButton.addEventListener('click', function () {
    var path = input.value.trim();
    if (!path) { toast('Pegá una ruta absoluta.'); return; }
    withBusy(function () { return useRoot(path); });
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { useButton.click(); }
  });
})();
</script>
</body>
</html>
`;
}
