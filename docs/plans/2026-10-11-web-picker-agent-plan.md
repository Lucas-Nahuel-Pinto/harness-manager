# Web Picker + Headless Agent — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-11-web-picker-agent-design.md` (commit 377b01d) · **Gate:** `bun run repo:check` green after every phase · **Repo stays shippable between phases**

## Phase 1 — Agent core (additive)

1. `mkdir src/agent` · `git mv src/desktop/browse.ts src/agent/browse.ts` · `git mv src/desktop/recents.ts src/agent/recents.ts` (logic unchanged); repoint tests `desktop-browse.test.ts → agent-browse.test.ts`, `desktop-recents.test.ts → agent-recents.test.ts`.
2. NEW `src/agent/controller.ts` — pure lifecycle, injectable seams (no real dialogs/fs/network in tests):
   - `AgentState = 'picker' | 'running'`; `bindRoot(path)` → validate (same Spanish copy as `validateRoot`, moved here) → swap the bound handler (`createAppFactory(rootAbs)`, DI seam) → recents updated ONLY on success → `{ok:true}`; failure → `{ok:false,detail}`, state stays `picker`.
   - `handler(req)` routing order: `/api/agent/status` → `{state,root}` · `/api/agent/recents` → `RecentEntry[]` · `/api/agent/browse` → `pickFolder()` seam (DI; browse waits on a human → generous timeout at the caller) · `/api/agent/root` (POST, `{root}`) → `bindRoot` · else → bound `createApp(req)` when running · else → 404 `{error:'no_root'}`.
   - Rebind allowed while `running` (switch harness in place, spec §3.9).
   - Recents file: `data/recents.json` resolved from `import.meta.dir` (repo dir, cwd-independent) — closes open item.
3. NEW `src/agent/routes.ts` — request/response codec for the four agent routes (JSON parse, method+path matching, Spanish error bodies).
4. NEW `agent.ts` entry — argv: optional positional code, `--relay ws…` override (reuse `parseOnlineArgv` shape or a 5-line parse); code absent → `generateCode()` + print pairing URL (`pairingUrl(PAGES_URL, code)`) on every connect (the `Online:`-equivalent line); `startRelayClient({relayUrl, code, fetchHandler: controller.handler})` as `role:'engine'`; `process.on('exit')` closes the client.
5. Tests — `agent-controller.test.ts` (migrate the still-relevant `desktop-controller.test.ts` cases: validation matrix, recents-only-on-success, `Online:`-line filter dies here — DELETE spawn/kill/crash cases): status before/after bind, routing order, unbound → `no_root`, delegate receives request when bound, rebind replaces handler, browse route returns dialog result / `browse_unsupported` propagates, argv parsing. `verify:` `bun test` green, `types:check` clean.

**Commit:** `feat: headless agent with web-controlled root picker routes`

## Phase 2 — Hosted launcher screen + web picker

1. NEW `src/online/launcher-screen.ts` (replaces `pairing-screen.ts`, DELETED):
   - `commandText(code)` pure fn → `` `bun agent.ts ${code}` `` (copyable; base32 `[A-Z2-7]` needs no shell quoting).
   - Launcher state: generate code (existing `#c=` in hash wins; else `generateCode()` → `history.replaceState('#c=…')`, never localStorage) → connect `WSTransport` as `ui` → show command + "ya tengo un motor" paste fallback (`extractCodeFromInput` → replace hash → reconnect).
   - On transport connect + engine presence → **picker state**: recents (`GET /api/agent/recents`) · "Elegir carpeta" (`POST /api/agent/browse`, 120 s timeout) · manual path (`POST /api/agent/root`) → `{ok:true}` → `bootApp('online')` (existing dashboard).
   - Inline errors (invalid root, `browse_unsupported`) reuse picker copy from the old local picker page.
2. `src/main.ts` — wire `online-unpaired` boot → launcher screen; keep `relayOverride` (`?relay=ws://…`) honored so `relay:dev` + `?relay=ws://127.0.0.1:8788` still works end-to-end (closes open item).
3. Tests — pure-function tests only (`commandText`, picker-state transition helpers if extracted); the screen itself stays thin (manual smoke; no DOM framework in repo).
4. Manual smoke (dev relay): `bun relay:dev` + hosted dev build with `?relay=` → site → command → `bun agent.ts <code> --relay ws://127.0.0.1:8788` → picker → bind → dashboard.
`verify:` `bun run repo:check` green.

**Commit:** `feat: hosted launcher screen with web harness picker`

## Phase 3 — Removals (breaking)

1. DELETE `src/desktop/**` (controller, view, main, electrobun-surface, rpc-schema, online-lines), `electrobun.config.ts`, dep `electrobun`, scripts `desktop`.
2. DELETE `src/launcher/**`, `launcher.ts`, tests `launcher.test.ts` + `desktop-controller.test.ts` remnants; scripts `serve`, `online`, `build` (vite singlefile local mode); simplify `vite.config.ts` to the online build only (keep `dev`).
3. `server.ts` → API-only diagnostic: drop `--online` + relay join (agent owns the online path); keep `--root`/`--port` loopback.
4. `src/server/app.ts` → drop `dist/index.html` serving + `injectServeFlags` (404 for non-`/api/`); DELETE `src/snapshot.ts`, `src/server-control.ts`; TRIM `src/serve.ts` of file:// bits, KEEP the `apiGet/apiPost` seam (`enableOnlineMode` swaps it).
5. `start-harness-manager.bat` / `.sh` → `bun agent.ts` (agent-generated flow: prints pairing URL).
6. `package.json` + `.gitignore` + README script tables updated; drop `dist/` from the pipeline.
`verify:` `bun run repo:check` green; `bun agent.ts` smoke (prints URL) + `bun server.ts` diagnostic smoke.

**Commit:** `refactor!: remove desktop app, loopback launcher and offline UI`

## Phase 4 — Docs, acceptance, closeout

1. `docs/acceptance.md` — L1–L22 rewritten: site → command → agent join → recents/browse/manual pick → rebind → Ctrl+C kills → disconnect banner → paste fallback → `?relay=` dev flow → diagnostic `server.ts`.
2. `README.md` — online-only quickstart (site URL → command → picker), kill = Ctrl+C, dev section (`relay:dev`, `?relay=`), remove Server-control / Desktop-entry / Electrobun sections; spec `Status` line updated to implemented.
3. Final gate + session footer; update Engram memory.
`verify:` `bun run repo:check` green, docs render, no dead references (`grep -r 'electrobun\|launcher.ts\|7397\|dist/index'` clean).

**Commit:** `docs: online-only web-picker README and acceptance`

## Risks

- **Electrobun dev-server leftovers** — Phase 3 must catch every import of deleted modules (types:check is the net).
- **Launcher-screen boot regressions** — `#c=` handling must stay compatible with the engine-generated flow (paste fallback); `online-mode.test.ts` protects `detectMode`.
- **Relay supersede semantics** — agent reconnect kicks its own stale join only; no second engine exists by design. Verified by existing `online-room.test.ts`.
