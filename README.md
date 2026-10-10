# harness-manager

A JTM-style harness snapshot manager: a panoramic dashboard to **visualize and manage the elements of any agent harness** (skills, commands, agents, MCPs, env, scripts, registries), following the same proven pattern as [`jira-traceability-manager`](https://github.com/Lucas-Nahuel-Pinto/jira-traceability-manager) — snapshot pipeline + self-contained single-file app — but pointed at a harness directory instead of Jira, and with a local server layer that enables real management actions (toggle MCPs, run scripts, assign models), always through diff + confirmation.

## Install

```bash
bun install
```

No `.env` needed: the scanner only reads files inside the target harness root. Env vars are reported by **presence** (`.env.example` vs `.env`) — **values are never read into the snapshot**.

## Commands

| Command | Effect |
| --- | --- |
| `bun run dev` | Vite dev server (HMR, source mode) |
| `bun run pull` | Scan harness root → `data/harness.json` (ajv-validated, atomic write, fail-safe) |
| `bun run build` | Embed snapshot → `dist/index.html` (read-only, double-click) |
| `bun run serve` | Build + **launcher** on `127.0.0.1:7397` (UI with Iniciar/Detener buttons for the engine) |
| `bun run engine` | Run only the API engine (`server.ts`, dynamic port, own copy of the UI) |
| `bun test` | Test suite |
| `bun run types:check` | TypeScript strict check (`tsc --noEmit`) |
| `bun run lint` / `bun run lint:fix` | ESLint (`@antfu/eslint-config`) |
| `bun run format:check` / `bun run format:fix` | Prettier |
| `bun run repo:check` | Full gate: `format:check` → `lint` → `types:check` → `test` |

Scan root resolution: `--root <path>` flag → `HARNESS_ROOT` env var → current working directory (for `pull` / `build` / engine CLI). Exception: `bun run serve` without either opens the launcher **root picker** instead of defaulting to cwd — see [Desktop entry](#desktop-entry). An optional `harness.json` in the target root declares non-standard locations (skills globs, models config); auto-detection covers the well-known paths out of the box.

## Server control

`bun run serve` now starts a **launcher**: it serves the built UI forever on `http://127.0.0.1:7397` (loopback only) and owns the engine process. The header shows a status dot (verde/ámbar/rojo) plus **Iniciar servidor / Detener servidor**:

- **Iniciar** spawns `bun server.ts --root <root> --port 0` (dynamic port), waits until it answers, stores the engine URL, and re-fetches the snapshot in place — no page reload. All actions (MCP toggle, script run, model assign, open, Re-scan) enable.
- **Detener** kills the engine (graceful, 5s escalation) and **the page stays alive** on the last snapshot — actions disable with a "Servidor detenido" hint until you start again.
- The engine keeps its own copy of the UI, so `bun run engine` (direct mode) works unchanged: no start/stop buttons, stop with Ctrl+C.
- The UI polls `GET /api/status` every 3s, so an engine crash flips the badge and disables actions too.

**file:// fallback**: the static build's "Iniciar servidor" button probes `127.0.0.1:7397`. A live launcher is offered as "Abrir en el launcher"; otherwise a modal hands over the copyable `bun run serve --root …` command (a browser cannot spawn processes).

| Env / flag | Effect |
| --- | --- |
| `--port <n>` / `HM_LAUNCHER_PORT` | Launcher port (default `7397`) |
| `HM_NO_OPEN=1` | Don't auto-open the browser on launcher start |
| `--root <path>` | Harness root (launcher + engine). Omitted in `serve`: picker page instead of cwd default. Engine CLI default: cwd |
| `--port <n>` / `HM_PORT` | Engine port when running `bun run engine` directly (default `0` = random) |

### Desktop entry

Double-click the launcher without typing a command: `start-harness-manager.bat` (Windows) or `start-harness-manager.sh` (POSIX — `chmod +x start-harness-manager.sh` once) starts `bun run serve` with no root, so the browser opens a **root picker**:

- **Recents** — last 10 harness roots (MRU, `data/recents.json`), one click to start.
- **Examinar…** — native OS folder dialog opened by the launcher (PowerShell dialog on Windows, `osascript` on macOS, `zenity`/`kdialog` on Linux). If no dialog tool exists on Linux, a toast points you to the manual input.
- **Manual input** — type or paste any absolute path (universal fallback on every OS).

After the pick, the engine spawns with that root (forwarding `--online` args if present) and the page becomes the normal dashboard. No harness switching while running — restart the launcher to change root. To skip the picker entirely, pass `--root` / `HARNESS_ROOT` as before.

To double-click without a console window on Windows, point a shortcut at:

```
wscript.exe //B //Nologo "<path>\hide-and-run.vbs"
```

with a `hide-and-run.vbs` you create yourself (not committed):

```vbs
CreateObject("Wscript.Shell").Run """C:\path\to\harness-manager\start-harness-manager.bat""", 0, False
```

On macOS, Finder users can duplicate `start-harness-manager.sh` and rename it to `start-harness-manager.command` (or add an Alias to the Dock); on Linux, add a `.desktop` launcher whose `Exec` points at the `.sh`.

## Model catalog

Harness-manager owns the model-catalog fetch — the harness only reads the file (offline-graceful: missing or stale → model-dependent features skip, nothing crashes). On every rescan, if the harness declares interest (manifest `models`, an existing `.models.catalog.json`, or a `harness-config` script) and the catalog is missing or older than 24h, the engine fetches it natively (no subprocess), writes it atomically, and only then scans. On total fetch failure the old file stays untouched and the snapshot carries a refresh warning.

Sources: the public OpenCode Zen endpoints plus `models.dev` metadata (deprecated models filtered). Provider endpoints (Google / Anthropic / OpenAI / DeepSeek / Kimi) are added only when their key exists in harness-manager's own `process.env` — keys are used transiently in the request and never persisted, displayed, or read from harness `.env` files. `MODELS_CATALOG_URLS` (comma-separated) overrides the source list; `MODELS_CACHE_TTL` (seconds) overrides the staleness TTL.

## Online mode (web)

Open the full dashboard from **any device on any network** while every harness file and credential stays on the operator's machine. A hosted static UI (Cloudflare Workers static assets) talks to the local engine through an end-to-end-encrypted relay (Cloudflare Worker + Durable Object). The browser is a remote control, not a file store: the relay only forwards opaque AES-GCM frames and never sees the session code, the key, or any harness data.

### Security model

| What travels (through the relay) | What NEVER travels |
| --- | --- |
| AES-GCM encrypted frames — the relay forwards opaque bytes and stores nothing | `.env` values (the scanner reads key **names** only — invariant unchanged) |
| Room id = SHA-256(session code) | The session code itself — it lives in the URL **fragment** (`#c=`), which browsers never send to any server |
| Join control `{room, role}` + presence (roles/counts only, cleartext metadata) | The snapshot outside the encrypted channel |
| | Source-form absolute paths outside the encrypted channel |

The engine always binds `127.0.0.1` and only makes **outbound** connections to the relay — no inbound ports, no firewall changes. The session code is regenerated on every engine start (new room); stale rooms expire after 24h idle.

### Commands

| Command | Effect |
| --- | --- |
| `bun run online` | Online build + engine with `--online`; prints `Online: <PAGES_URL>/#c=<CODE>` next to the local URL |
| `bun run build:online` | UI build for the hosted origin → `dist-online/` (no embedded snapshot, empty "esperando motor" state) |
| `bun run deploy:ui` | `build:online` + `wrangler deploy` (root `wrangler.jsonc` serves `dist-online/`) |
| `bun run relay:dev` | Local relay on `ws://127.0.0.1:8788` — same routing logic as the deployed Worker |
| `bun run urls:bake <pagesUrl> <relayUrl>` | Bake the deployed URLs into the committed constants in `src/online/pairing.ts` |

### Deploy / update

```bash
bunx wrangler login                                # once, interactive — user-owned credentials
bun run urls:bake https://harness-manager.harness-manager.workers.dev wss://harness-manager-relay.harness-manager.workers.dev
bunx wrangler deploy -c relay/wrangler.toml        # relay Worker + Durable Object (dumb relay, no secrets)
bun run deploy:ui                                  # build:online + wrangler deploy → hosted UI
```

Re-deploying an update repeats `deploy:ui` (and the relay command only when `relay/` changed). The Worker holds no secrets and no harness data; changing a URL is a normal commit + redeploy. Gotcha: if wrangler prints `Using redirected Wrangler configuration: dist\wrangler.json`, delete `.wrangler/deploy/` first — it is a stale redirect from project creation that would redeploy the wrong (local, data-embedded) build.

### Pairing flow

1. `bun run online --root <harness>` — the engine prints `Online: https://harness-manager.harness-manager.workers.dev/#c=<CODE>` next to the local URL once the relay connection is up.
2. Open that URL from any device (the code lives in the fragment, so it is never transmitted). A hosted origin without `#c=` shows the pairing screen — paste the full pairing URL or the bare code.
3. The UI derives the room + key from the code identically to the engine, joins the relay, and streams the snapshot end-to-end-encrypted. Stop the engine → the UI shows the offline banner; restart → new code, new room (the old room dies with the old engine).

**Local mode is unchanged**: opening the UI via `file://` or `127.0.0.1` (no `#c=`) talks to the local engine over plain fetch, exactly as before.

## The 6 tabs

| Tab | Content |
| --- | --- |
| **Resumen** | KPI counts (skills, commands, agents, MCPs, env, scripts, registries) + health columns **H-J**. Each health card is clickable → drill-down detail (required docs with paths, workflows + husky hooks, gate scripts + stale registries + snapshot warnings). |
| **Skills + Commands** | Sortable table (tier, refs, evals, registered, state) + commands section; detail panel with triggers/refs/scripts and copy-path. |
| **Agents & Modelos** | Main agent + subagent table with current `model:` frontmatter; model picker from `.models.catalog.json` with diff + confirm (serve mode only). |
| **MCPs + Env** | MCP cards (config file, enabled state, env refs) with toggle action; env presence matrix (`.env.example` vs `.env`, read-only). |
| **Scripts + Registros** | Script runner with output pane (serve mode only) + registry status/staleness. |
| **Grafo** | Cytoscape + fcose relational graph (skill → refs → scripts, agent → skills, MCP → env); per-filter position cache, selection illumination, click → detail. |

Shell mirrors JTM: collapsible left filter panel, collapsible right detail panel, server-mode badge with snapshot freshness.

## Action safety model

Every write action runs through the same pipeline:

```
compute diff → UI shows unified diff → user confirms → atomic write (temp + rename) → automatic re-scan
```

- **Server-enforced staging**: `POST /api/action` returns `{ diff }` first; the server only applies when the same request is re-sent with `confirm: true`. Not just a UI courtesy.
- **Loopback only**: the launcher (7397) and the engine (dynamic port) both bind `127.0.0.1`. Never exposed on the network.
- **Path guard**: every resolved write target must stay inside the harness root — path traversal is rejected and tested.
- **Script-name whitelist**: the runner only accepts script names declared in the target harness `package.json`, runs with `cwd = root`, and captures output. The UI never sends arbitrary command strings.
- **`.env` untouchable**: actions only touch MCP config, agent frontmatter / session model config, and script execution. `.env` **values are never read** — only names and presence enter the snapshot, so a shared snapshot cannot leak secrets.
- **Read-only build**: `dist/index.html` (double-click / file://) renders with action buttons disabled and the "modo solo lectura" badge; the header's "Iniciar servidor" button probes a running launcher or hands over the command.
- **Structured errors**: the API returns `{ error, detail }`, the UI toasts, and partial writes never happen.

### Known limitation — MCP toggle vs Claude Code

Toggling an MCP writes `"enabled": false` (opencode semantics) into `opencode.jsonc` / `.mcp.json`. **Claude Code ignores the `enabled` key in `.mcp.json`** (flagged during Phase 5): a disabled MCP still loads in Claude Code until it is removed from the file or the session config. OpenCode honors `enabled`. The toggle is therefore fully effective on OpenCode harnesses and display-only for Claude Code consumers.

## Development

- `window.__hmGraph` — test hook exposed by the Grafo tab: `{ nodes, first() }` where `nodes` is the visible node count of the last update and `first()` returns the first visible node id + canvas-relative position (drives synthetic click tests).
- `window.__HM_SERVE__` / `window.__HM_ROOT__` — injected by the engine's serve route so the UI knows it is in direct-serve mode (actions enabled) and which root it points at.
- `window.__HM_LAUNCHER__` — injected by the launcher's `/` route; the UI then gets its engine URL from `GET /api/status` instead of assuming same-origin.
- `data/harness.json` and `dist/index.html` are **generated** — never hand-edit (the build embeds the snapshot).
- Snapshot schema: `harness.schema.json` (`schemaVersion: 1`, validated by ajv on every pull).

## Screenshots

_TODO — capture into `docs/screenshots/` before publishing:_

- `docs/screenshots/resumen.png` — Resumen tab with KPI grid + health columns H-J
- `docs/screenshots/serve-diff-confirm.png` — serve-mode action confirm modal showing a unified diff
- `docs/screenshots/grafo.png` — Grafo tab with selection illumination

## Docs

- Design: `docs/superpowers/specs/2026-10-07-harness-manager-design.md`
- Plan: `docs/plans/2026-10-07-implementation-plan.md`
- Acceptance checklist: `docs/acceptance.md`

## License

MIT (see `LICENSE`). Repository stays **private** until the sanitization pass and user visual sign-off are complete; publishable afterwards as a portfolio piece.
