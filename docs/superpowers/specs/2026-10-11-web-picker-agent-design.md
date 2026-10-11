# Web Picker + Headless Agent — Design

**Date:** 2026-10-11 · **Status:** approved decisions, pre-implementation · **Scope:** harness-manager repo only
**Supersedes:** `2026-10-10-desktop-app-online-only-design.md` (Electrobun desktop app — Fases 1-2 shipped, to be deleted)

## 1. Problem

"100% online" was clarified: the launcher **and** the harness picker must live on the hosted website, with all local UI eliminated — no loopback server, no embedded offline dashboard, **no desktop window**. The Electrobun app just shipped (Fases 1-2) puts the picker in a local window, which is now the wrong destination. The harness itself must still run on the operator's machine (tests run over the local working tree, `.env` and all), so *something* local has to survive — it must be invisible: no port, no window, no UI.

## 2. Goal

Open the hosted app → a **launcher screen** generates a pairing code and shows a one-line bootstrap command → the operator runs it on their PC → a **headless agent** joins the relay → the same website shows the harness picker (recents + native folder dialog + manual path) → on pick, the dashboard boots against the local engine. Everything the user sees lives at `PAGES_URL`; the local side is one terminal-less-feeling Bun process that can be closed with Ctrl+C.

```
SITIO WEB (todo el UI)                          TU PC (un solo proceso)
┌─────────────────────────────────┐             ┌──────────────────────────────┐
│ launcher: código + comando      │             │ agent.ts <code>              │
│   ── espera presencia ──        │  ←relay→    │   join relay como role engine│
│ picker: recents · diálogo nativo│             │   /api/agent/{status,recents, │
│   · ruta manual                 │── /api/agent/root ─→ browse,root}        │
│ dashboard (arranque existente)  │── /api/* ──→│   bind createApp(root) en    │
└─────────────────────────────────┘             │   proceso · snapshot/run     │
                                                └──────────────────────────────┘
```

## 3. Binding decisions

1. **Agent = engine, one process.** `agent.ts` joins the relay **immediately** (`startRelayClient` with an agent fetch-handler). Picking a root binds `createApp(rootAbs)` **in-process** — no child spawn, no `Online:` stdout capture, no kill-with-escalation. The relay rule "one engine per room, new join supersedes" is satisfied by construction (the agent is the only engine; its reconnect supersedes itself).
2. **Site-generated code (primary flow).** The unpaired screen generates the code (`generateCode()` — pure WebCrypto, works in the browser), writes it to `#c=` (`history.replaceState`, never localStorage), connects as `ui`, and waits for the agent. The displayed command is `bun agent.ts <code>`. **Agent-generated flow (secondary)**: `bun agent.ts` with no arg generates its own code and prints the pairing URL to the console (today's `Online:` behavior) — this keeps `start-harness-manager.bat`/`.sh` double-click useful. Both flows share one room.
3. **Agent routes (namespaced, `/api/…` as the relay protocol requires):**
   - `GET /api/agent/status` → `{state, root?}` (`picker` | `running`)
   - `GET /api/agent/recents` → `RecentEntry[]` (existing MRU, cap 10, `data/recents.json`)
   - `POST /api/agent/browse` → native OS dialog via existing `pickFolder()` — **extended timeout (120 s)**, it waits on a human; `browse_unsupported` (headless Linux) → UI falls back to manual path
   - `POST /api/agent/root` `{root}` → validate (exists, absolute, directory) → bind → recents update; invalid → inline error, stay in picker
   - Anything else → delegate to the bound `createApp`; **404 `{error:'no_root'}`** while unbound (the hosted UI's `refreshSnapshot` already tolerates this)
4. **Relay, protocol and crypto unchanged.** No new member role, no relay changes, no new frame types. The control channel is just more `/api/*` requests over the existing E2E-encrypted `req`/`res` frames. Multiple tabs keep working (broadcast responses disambiguated by `id`).
5. **Hosted UI gains one screen.** `online-unpaired` boot (today: paste-code landing) becomes the **launcher screen**: generate code + copyable command + "ya tengo un motor" paste fallback (existing `extractCodeFromInput`). When presence reports an `engine` while unpaired → auto-advance to the **picker state** (recents + "Elegir carpeta" + manual path); after a successful `/api/agent/root` → `bootApp('online')` unchanged dashboard.
6. **Electrobun + loopback launcher deleted outright** (user decision): `src/desktop/**`, `electrobun.config.ts`, the `electrobun` dependency, the `desktop` script, `src/launcher/**`, `launcher.ts`, `serve`/`build` scripts (file:// + embedded snapshot), `src/snapshot.ts`, the `dist/index.html` serving branch in `src/server/app.ts`, `injectServeFlags`. Git history keeps the work.
7. **`server.ts` survives as a diagnostic** — API-only loopback (no UI, no `--online`) for dev/testing without the relay: `bun server.ts --root X`. The online path is owned exclusively by `agent.ts`.
8. **`browse.ts` + `recents.ts` move to `src/agent/`** (from `src/desktop/`), unchanged logic; their tests move with them (`agent-browse.test.ts`, `agent-recents.test.ts`).
9. **Stop = Ctrl+C.** No stop route from the site (consistent with the "no Detener button" decision); the dashboard shows the bound root and the offline banner on disconnect. Switching harness = re-pick a root (`/api/agent/root` rebinds in place).

## 4. Components

| File | Change |
| --- | --- |
| `agent.ts` | NEW — entry: parse `code?` / `--relay ws…`; generate-or-use code; join relay as `engine` with agent handler; print pairing URL when it generated the code |
| `src/agent/controller.ts` | NEW — pure lifecycle (injectable seams): state `picker`/`running`, `bindRoot` (validate → `createApp` → recents), recents load/save, handler routing (agent routes → delegate → `no_root` 404) |
| `src/agent/browse.ts`, `src/agent/recents.ts` | MOVED from `src/desktop/` (logic unchanged) |
| `src/agent/routes.ts` | NEW — `/api/agent/{status,recents,browse,root}` request/response codec + JSON responses |
| `src/desktop/**`, `electrobun.config.ts` | DELETED (Phases 1-2 of the superseded design) |
| `src/launcher/**`, `launcher.ts` | DELETED (loopback launcher, port 7397 dies) |
| `src/online/pairing.ts` | `generateCode()` reused browser-side (pure WebCrypto — verify no Node-only imports); no other change |
| `src/online/pairing-screen.ts` | REPLACED by `src/online/launcher-screen.ts` (generate + command + paste fallback) |
| `src/main.ts` | Boot wiring: `online-unpaired` → launcher screen → picker state → `bootApp('online')` |
| `src/server/app.ts`, `server.ts` | API-only: drop `dist/index.html` serving, `injectServeFlags`, `--online`; keep loopback diagnostic |
| `src/serve.ts`, `src/snapshot.ts`, `src/server-control.ts` | DELETED (offline/file:// UI remnants) |
| `package.json` | DEPS: `electrobun` out. SCRIPTS: `agent` (`bun agent.ts`) in; `serve`, `build`, `desktop` out; `build:online`/`deploy:ui`/`dev`/`relay:dev` stay |
| `start-harness-manager.bat` / `.sh` | run `bun agent.ts` (agent-generated flow) |
| `tests/` | desktop/launcher tests → `agent-controller.test.ts` (spawn/seam matrix from `desktop-controller.test.ts` adapted: no spawn, bind instead; `Online:`/kill tests deleted); browse/recents tests renamed+repointed; launcher tests deleted; new route-codec tests |
| `docs/acceptance.md` | L1–L22 rewritten for the web-picker flow: launcher command, agent join, recents/browse/manual pick, rebind, disconnect banner |
| `README.md` | Online-only quickstart: site → command → picker; kill = Ctrl+C; local diagnostic `server.ts` documented as dev-only |

## 5. Error handling

- Agent run with an invalid/expired code → the site simply never sees presence (UI keeps showing the command + a "revisá que el código coincida" hint). Room expires 24 h idle (existing).
- Invalid root at `/api/agent/root` → inline picker error, no bind, recents untouched (reuses the desktop controller's validation semantics).
- `browse_unsupported` / dialog cancelled → picker stays; manual path remains available.
- Agent Ctrl+C / crash while running → transport offline banner (existing) + picker offered again on the next visit to the room with a fresh code (rooms die with the engine join).
- Relay unreachable at agent start → backoff + console line (existing engine behavior); site shows "esperando agente".
- `res` broadcast: every tab sees every response (accepted pre-existing model — no secrets in responses, only user-owned paths and sanitized snapshot).

## 6. Testing

- `agent-controller.test.ts` — unit seams (no real processes/dialogs): status before/after bind, `bindRoot` validation matrix, recents updated only on successful bind, rebind replaces handler, route ordering (agent routes win over delegate; unbound → `no_root` 404; bound → delegate receives request), `--code`/`--relay` argv parsing, browse extended timeout passed through.
- Migrated `agent-browse` / `agent-recents` tests (paths only).
- `online-*` tests untouched (relay/protocol/crypto/transport/pairing) — `pairing` gains a browser-compat check if `generateCode` imports anything Node-only.
- Hosted launcher screen stays thin (manual smoke, L-list in acceptance).
- Full gate `bun run repo:check` green after each phase.

## 7. Non-goals

File System Access API directory navigator (Chromium-only, no absolute path exposed — manual path + native dialog cover first pick), accounts/QR/multi-room dashboard, stop-route from the site, packaging a zero-install bootstrap (`bunx`/npm publish), LAN/no-internet mode, engine start/stop from the hosted dashboard, auto-updater.

## 8. Open items

- **Code shape in the command** — 26-char base32 pasted into a shell arg is fine; confirm no quoting issues on Windows `cmd` (base32 is `[A-Z2-7]`, safe).
- **Picker state ownership** — picker lives in the hosted UI only, but the agent also knows its recents/state; define a single source of truth (agent is authoritative; UI renders its responses).
- **`relay:dev` + `?relay=ws://127.0.0.1:8788`** already supports dev-without-deploy; verify the launcher screen honors `relayOverride` like `WSTransport` does.
- Whether `data/recents.json` should live next to the repo instead of the cwd (agent entry may be launched from anywhere) — decide in the plan phase.
