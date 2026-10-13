# harness-manager

A panoramic dashboard to **visualize and manage the elements of any agent harness** (skills, commands, agents, MCPs, env, scripts, registries): snapshot pipeline + self-contained single-file app pointed at a harness directory, with **100% online UI**: the dashboard and the harness picker live on the hosted website, and a headless local agent executes the real management actions (toggle MCPs, run scripts, assign models), always through diff + confirmation.

## Install

```bash
bun install
```

No `.env` needed: the scanner only reads files inside the target harness root. Env vars are reported by **presence** (`.env.example` vs `.env`) — **values are never read into the snapshot**.

## Quickstart (online-only)

1. Open the hosted app: <https://harness-manager.harness-manager.workers.dev>
2. Copy the shown command: `bun agent.ts <CODE>` and run it **on the PC where your harness lives — always from the `harness-manager/` directory** (needs Bun; clone this repo and `cd harness-manager` first: `agent.ts` lives here, so the command only works inside this directory).
3. The website shows the harness picker (recents · **Elegir carpeta…** native dialog · manual absolute path) — pick your root and the dashboard loads. Stop the agent with Ctrl+C.

`start-harness-manager.bat` / `.sh` run `bun agent.ts` with no code (they `cd` into their own directory first, so they work from anywhere): the agent generates its own room and prints the pairing URL to open.

## Commands

| Command | Effect |
| --- | --- |
| `bun run agent [code] [--relay ws…]` | Headless agent: joins the relay, serves the web picker routes + the bound dashboard. No code → generates one and prints the pairing URL |
| `bun run build:online` | UI build for the hosted origin → `dist-online/` (no embedded snapshot, "esperando motor" shell) |
| `bun run pull` | Scan harness root → `data/harness.json` (ajv-validated, atomic write, fail-safe) — diagnostic CLI |
| `bun run engine` | API-only loopback diagnostic (`server.ts`, dynamic port, NO UI) — local dev/testing without the relay |
| `bun run dev` | Vite dev server for the online UI — pair it with `relay:dev` (see Development); no `/api` proxy anymore |
| `bun test` | Test suite |
| `bun run types:check` | TypeScript strict check (`tsc --noEmit`) |
| `bun run lint` / `bun run lint:fix` | ESLint (`@antfu/eslint-config`) |
| `bun run format:check` / `bun run format:fix` | Prettier |
| `bun run repo:check` | Full gate: `format:check` → `lint` → `types:check` → `test` |

Scan root resolution: `--root <path>` flag → `HARNESS_ROOT` env var → current working directory (for `pull` / engine CLI). An optional `harness.json` in the target root declares non-standard locations (skills globs, models config); auto-detection covers the well-known paths out of the box.

## Local side: headless agent

The agent **is** the engine (one process, no window, no local port): it joins the relay immediately and picking a root on the website binds the dashboard handler in-process. The local footprint is exactly this terminal process.

- **Picker over the relay** — the website drives `/api/agent/{status,recents,browse,root}`: recents (MRU 10, `data/recents.json`), the native OS folder dialog (PowerShell on Windows, `osascript` on macOS, `zenity`/`kdialog` on Linux; without a dialog tool the site falls back to manual path input), and manual absolute-path entry with validation.
- **Switching harness** — re-pick a root from the website: the agent rebinds in place, no restart.
- **Stop** — Ctrl+C on the agent. Closing the browser never kills anything; the agent keeps its room until it exits.
- **`--relay ws://127.0.0.1:8788`** (with `bun run relay:dev`) runs the whole flow against a local relay without touching the deployed one.

## Model catalog

Harness-manager owns the model-catalog fetch — the harness only reads the file (offline-graceful: missing or stale → model-dependent features skip, nothing crashes). On every rescan, if the harness declares interest (manifest `models`, an existing `.models.catalog.json`, or a `harness-config` script) and the catalog is missing or older than 24h, harness-manager refreshes it natively (no subprocess), writes it atomically, and only then scans. On total fetch failure the old file stays untouched and the snapshot carries a refresh warning.

Sources: the public OpenCode Zen endpoints plus `models.dev` metadata (deprecated models filtered). Provider endpoints (Google / Anthropic / OpenAI / DeepSeek / Kimi) are added only when their key exists in harness-manager's own `process.env` — keys are used transiently in the request and never persisted, displayed, or read from harness `.env` files. `MODELS_CATALOG_URLS` (comma-separated) overrides the source list; `MODELS_CACHE_TTL` (seconds) overrides the staleness TTL.

## Online mode (web)

The hosted UI **is** the product: the dashboard and the harness picker live on Cloudflare Workers static assets and talk to the local agent through an end-to-end-encrypted relay (Cloudflare Worker + Durable Object). The browser is a remote control, not a file store: the relay only forwards opaque AES-GCM frames and never sees the session code, the key, or any harness data. Internet is a hard requirement — there is no local UI.

### Security model

| What travels (through the relay) | What NEVER travels |
| --- | --- |
| AES-GCM encrypted frames — the relay forwards opaque bytes and stores nothing | `.env` values (the scanner reads key **names** only — invariant unchanged) |
| Room id = SHA-256(session code) | The session code itself — it lives in the URL **fragment** (`#c=`), which browsers never send to any server |
| Join control `{room, role}` + presence (roles/counts only, cleartext metadata) | The snapshot outside the encrypted channel |
| | Source-form absolute paths outside the encrypted channel |

The agent always binds outbound-only connections to the relay — no inbound ports, no firewall changes. The session code is 128-bit CSPRNG; rooms expire after 24h idle.

### Commands

| Command | Effect |
| --- | --- |
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

Re-deploying an update repeats `deploy:ui` (and the relay command only when `relay/` changed). The Worker holds no secrets and no harness data; changing a URL is a normal commit + redeploy. Gotcha: if wrangler prints `Using redirected Wrangler configuration: dist\wrangler.json`, delete `.wrangler/deploy/` first — it is a stale redirect from project creation that would redeploy the wrong output.

### Launcher flow (site-generated code)

1. Open the hosted origin **without** `#c=` → the **launcher screen** generates a session code, keeps it in the URL fragment, and shows the one-line command `bun agent.ts <CODE>` (copy button) while waiting for the agent to join the room.
2. Run the command on the PC where the harness lives, **from the `harness-manager/` directory** (the bare `bun agent.ts` only works inside the repo — `cd harness-manager` first). The agent derives room + key from the same code, joins the relay as the engine, and the site advances to the **harness picker** (recents · native dialog · manual path).
3. Pick a root → the dashboard boots over the same encrypted channel. Re-picking a root rebinds the agent in place; Ctrl+C on the agent shows the offline banner.
4. **Paste fallback**: if the agent was started first (`bun agent.ts` with no code — it prints `Online: <PAGES_URL>/#c=<CODE>`), paste that URL/code into the launcher screen to join its room instead.
5. **Share the control**: send someone the pairing URL (`<PAGES_URL>/#c=<CODE>`) — they open it from any browser and land in the same room, controlling the same harness; the code is the session credential, so share it only with people you trust.

## The 6 tabs

| Tab | Content |
| --- | --- |
| **Resumen** | KPI counts (skills, commands, agents, MCPs, env, scripts, registries) + health columns **H-J**. Each health card is clickable → drill-down detail (required docs with paths, workflows + husky hooks, gate scripts + stale registries + snapshot warnings). |
| **Skills + Commands** | Sortable table (tier, refs, evals, registered, state) + commands section; detail panel with triggers/refs/scripts and copy-path. |
| **Agents & Modelos** | Main agent + subagent table with current `model:` frontmatter; model picker from `.models.catalog.json` with diff + confirm (serve mode only). |
| **MCPs + Env** | MCP cards (config file, enabled state, env refs) with toggle action; env presence matrix (`.env.example` vs `.env`, read-only). |
| **Scripts + Registros** | Script runner with output pane (serve mode only) + registry status/staleness. |
| **Grafo** | Cytoscape + fcose relational graph (skill → refs → scripts, agent → skills, MCP → env); per-filter position cache, selection illumination, click → detail. |

Shell: collapsible left filter panel, collapsible right detail panel, server-mode badge with snapshot freshness.

## Action safety model

Every write action runs through the same pipeline:

```
compute diff → UI shows unified diff → user confirms → atomic write (temp + rename) → automatic re-scan
```

- **Server-enforced staging**: `POST /api/action` returns `{ diff }` first; the server only applies when the same request is re-sent with `confirm: true`. Not just a UI courtesy.
- **Outbound-only local side**: the agent opens a single outbound connection to the relay; the diagnostic engine binds `127.0.0.1`. No inbound ports, no firewall changes.
- **Path guard**: every resolved write target must stay inside the harness root — path traversal is rejected and tested.
- **Script-name whitelist**: the runner only accepts script names declared in the target harness `package.json`, runs with `cwd = root`, and captures output. The UI never sends arbitrary command strings.
- **`.env` untouchable**: actions only touch MCP config, agent frontmatter / session model config, and script execution. `.env` **values are never read** — only names and presence enter the snapshot, so a shared snapshot cannot leak secrets.
- **No local UI**: there is nothing local to harden — the bundle embeds no harness data, and the API-only diagnostic engine never serves HTML.
- **Structured errors**: the API returns `{ error, detail }`, the UI toasts, and partial writes never happen.

### Known limitation — MCP toggle vs Claude Code

Toggling an MCP writes `"enabled": false` (opencode semantics) into `opencode.jsonc` / `.mcp.json`. **Claude Code ignores the `enabled` key in `.mcp.json`** (flagged during Phase 5): a disabled MCP still loads in Claude Code until it is removed from the file or the session config. OpenCode honors `enabled`. The toggle is therefore fully effective on OpenCode harnesses and display-only for Claude Code consumers.

## Development

- `window.__hmGraph` — test hook exposed by the Grafo tab: `{ nodes, first() }` where `nodes` is the visible node count of the last update and `first()` returns the first visible node id + canvas-relative position (drives synthetic click tests).
- Local dev loop (the only loop — there is no local fetch path anymore, spec 2026-10-12): `bun run relay:dev` + `bun run dev` → open `http://localhost:5173/?relay=ws://127.0.0.1:8788` → the launcher generates the command → `bun agent.ts <CODE> --relay ws://127.0.0.1:8788` — the same flow production runs.
- `data/harness.json` is **generated** by `bun run pull` (diagnostic output — no embedded consumer anymore); never hand-edit.
- Snapshot schema: `harness.schema.json` (`schemaVersion: 1`, validated by ajv on every pull).

## Screenshots

_TODO — capture into `docs/screenshots/` before publishing:_

- `docs/screenshots/resumen.png` — Resumen tab with KPI grid + health columns H-J
- `docs/screenshots/serve-diff-confirm.png` — serve-mode action confirm modal showing a unified diff
- `docs/screenshots/grafo.png` — Grafo tab with selection illumination

## Docs

- Design: `docs/superpowers/specs/2026-10-07-harness-manager-design.md`
- Plan: `docs/plans/2026-10-07-implementation-plan.md`
- Web picker + headless agent (current architecture): `docs/superpowers/specs/2026-10-11-web-picker-agent-design.md`
- Online vs. 100% offline (why hosted): `docs/online-vs-offline.md`
- Acceptance checklist: `docs/acceptance.md`

## License

MIT (see `LICENSE`). Repository stays **private** until the sanitization pass and user visual sign-off are complete; publishable afterwards as a portfolio piece.
