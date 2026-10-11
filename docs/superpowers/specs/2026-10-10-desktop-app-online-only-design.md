# Desktop App (Electrobun) — Online-Only Companion · Design

## 1. Problem

The launcher's local web UI (picker page + embedded offline dashboard on `127.0.0.1:7397`) is no longer wanted. The operator uses only the hosted web app; the local side should be a small cross-platform desktop window that starts the engine and hands off to the hosted app — no loopback server, no offline fallback.

## 2. Goal

Double-click the desktop entry → native window (Electrobun: Bun main process + system webview) shows the harness-root picker (recents, native browse dialog, manual path) → on pick, the app spawns `bun server.ts --root <root> --online`, captures the pairing URL printed on the engine stdout, and opens the **hosted** app (`PAGES_URL/#c=<code>`) already paired. The window stays as a compact monitor (root, status dot, "Abrir app" link). Closing the window kills the engine. The hosted app remains the only UI.

```
start-harness-manager.bat → bun run desktop (electrobun run)
┌─ Desktop window (Electrobun) ──────────────────────────┐
│ main (Bun): engine lifecycle · recents · browse.ts ·   │
│             Online: URL capture · open(hosted) · kill  │
│ view (webview): picker state ⇄ running state           │
└────────────────────────────────────────────────────────┘
pick → spawn `bun server.ts --root X --online` (ALWAYS relayed)
     → open https://…workers.dev/#c=<code>   (hosted, auto-paired)
     → window: running state (root, dot, Abrir app)
close window → graceful engine kill (5s escalation, as today)
```

## 3. Binding decisions

1. **Electrobun** — main process is Bun/TS (`electrobun/bun`), UI is a system webview (`electrobun/view`), RPC between them. No Rust/Node toolchain. Runs from source (`electrobun run`) like the current `.bat` flow.
2. **Loopback server eliminated** — `src/launcher/` (HTTP server, routes, picker page serving) is removed entirely. Port `7397` ceases to exist. The previous in-browser picker and its API routes are replaced by in-process calls in the Electrobun main.
3. **Online-only** — the engine is always spawned with the online args (relay). `--online` flag retired. Internet is a hard requirement.
4. **No Detener button** — the window has exactly two states: *picker* and *running*. Stopping the engine = closing the window (graceful kill, 5s escalation, reusing the launcher's kill logic). Engine crash while running → status dot turns red + hint to reopen the app; restart = reopen + pick again (recents makes this one click).
5. **Reuse as-is**: `src/launcher/browse.ts` (native dialogs per OS), `src/launcher/recents.ts` (MRU cap 10, `data/recents.json`), the `Online:` stdout line filter, kill-with-timeout logic, picker HTML/CSS (ported into the Electrobun view with the same dark tokens).
6. **Offline UI removal (complete)**: local singlefile build (`bun run build`), `src/snapshot.ts` + `data/harness.json` embed, `file://` fallback (`fileModeStartFlow`, static-build start modal, local read-only badge), engine-served UI copy (`server.ts` becomes API-only), local start/stop UI (`server-control` launcher mode). `bun run dev` (Vite) remains for developing the hosted frontend.
7. **Hosted app unchanged** — it already boots into online mode from a valid `#c=` fragment; zero changes required there. Engine start/stop from the hosted UI stays out of scope.
8. **Window lifecycle** — after a successful pick the window switches to the running state and MUST stay open (it owns the engine process). "Abrir app" re-opens the hosted pairing URL in the default browser (useful if the tab was closed). `HM_NO_OPEN` suppresses the automatic browser open (console-only pairing URL as fallback).
9. **Bootstrap** — `start-harness-manager.bat` / `.sh` now run `bun run desktop`. Desktop-entry docs (Finder alias, Linux `.desktop`, hidden-console `wscript`) carry over from the README section.

## 4. Components

| File | Change |
| --- | --- |
| `electrobun.config.ts` | NEW — app metadata, Bun entrypoint `src/desktop/main.ts`, view entrypoint |
| `src/desktop/main.ts` | NEW — thin Electrobun glue: window, RPC wiring, browser open, kill on quit |
| `src/desktop/controller.ts` | NEW — pure lifecycle logic (fake-injectable): load recents, `pickRoot()` (validate → spawn → capture pairing URL → add recent), `detener()`/kill, status state machine |
| `src/desktop/view/` | NEW — HTML/TS picker + running states (port of `src/launcher/picker.ts`, same tokens); RPC client calls only |
| `src/launcher/app.ts`, `launcher.ts`, `src/launcher/picker.ts` | DELETED (browse.ts + recents.ts MOVE to `src/desktop/` or stay importable — decide in plan; no dead launcher code remains) |
| `src/server-control.ts`, `src/serve.ts` | trimmed to online-mode needs (badge, transport); launcher/file:// paths removed |
| `server.ts` | API-only: stop serving `dist/index.html` (online relay transport unchanged) |
| `package.json` | `electrobun` dependency; `desktop` script (`electrobun run`); `serve`/`build` retired; `build:online`/`deploy:ui` unchanged |
| `start-harness-manager.bat` / `.sh` | run `bun run desktop` |
| `scripts/pull.ts` | kept as diagnostic CLI (scan + schema); loses its embed consumer |
| `tests/launcher.test.ts` + browse/recents tests | migrate: controller tests replace launcher tests; browse/recents tests keep (paths updated); file:// / local-dashboard / engine-UI tests deleted |
| `docs/acceptance.md` | L1–L15 adjusted (no local dashboard), L16–L19 rewritten for the desktop flow, + L20 (close kills engine), L21 (crash → red dot) |
| `README.md` | Desktop-app section replaces Server-control + Desktop-entry text; online-only statement |

## 5. Error handling

- Invalid root (missing / relative / not a directory) → inline error in the window, stay in picker state.
- Engine fails to start (bun missing, port/relay unreachable at spawn) → toast with detail in the window, stay in picker; recents NOT updated.
- Relay unreachable at join → engine retries with backoff (existing behavior); window dot shows "conectando…" until the `Online:` line prints; pairing URL still opens (hosted app waits/reconnects).
- Engine crash while running → dot red + "motor caído — reabrí la app"; hosted app shows its offline banner (existing).
- WebView platform deps: Windows WebView2 (preinstalled on Win10/11), macOS WKWebView (system), Linux webkit2gtk package (documented prerequisite — same class of caveat as zenity).

## 6. Testing

- `controller.ts` unit tests (spawn/capture/open seams injected, zero real processes/dialogs): pick happy path (spawn args include `--root` + online args, pairing URL captured from stdout, recents updated, `open()` called with `PAGES_URL/#c=`), invalid root, spawn failure → no recents write, `Online:` filter (migrated), kill graceful + escalation timeout (migrated), crash transitions dot state, `HM_NO_OPEN` suppresses open.
- Electrobun glue (`main.ts`, view) stays thin — smoke-tested manually (L20+).
- Full gate `bun run repo:check` green after each phase.

## 7. Non-goals

Runtime harness switching, Detener-without-quit, engine control from the hosted UI, auto-updater, packaged `.exe`/`.dmg`/AppImage distribution, tray icon, multiple concurrent engines.

## 8. Open items

- Electrobun API churn (young framework): pin the version; verify `BrowserWindow` close-hook + RPC surface against the pinned docs in the plan phase (spec assumes close-kill is implementable via the window close event; fallback = `process.on('SIGINT'/'exit')` in main).
- Where `browse.ts`/`recents.ts` live after the launcher deletion (`src/desktop/` vs stay in `src/launcher/`) — mechanical, decide in plan.
- Whether `server.ts` keeps a `--port` flag for dev-only direct API testing (likely yes, unchanged).
