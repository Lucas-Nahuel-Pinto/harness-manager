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
| `bun run serve` | Build + local server with actions (toggle MCP, run scripts, assign models) |
| `bun test` | Test suite |
| `bun run types:check` | TypeScript strict check (`tsc --noEmit`) |
| `bun run lint` / `bun run lint:fix` | ESLint (`@antfu/eslint-config`) |
| `bun run format:check` / `bun run format:fix` | Prettier |
| `bun run repo:check` | Full gate: `format:check` → `lint` → `types:check` → `test` |

Scan root resolution: `--root <path>` flag → `HARNESS_ROOT` env var → current working directory. An optional `harness.json` in the target root declares non-standard locations (skills globs, models config); auto-detection covers the well-known paths out of the box.

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
- **Loopback only**: the server binds `127.0.0.1` (random port by default, overridable). Never exposed on the network.
- **Path guard**: every resolved write target must stay inside the harness root — path traversal is rejected and tested.
- **Script-name whitelist**: the runner only accepts script names declared in the target harness `package.json`, runs with `cwd = root`, and captures output. The UI never sends arbitrary command strings.
- **`.env` untouchable**: actions only touch MCP config, agent frontmatter / session model config, and script execution. `.env` **values are never read** — only names and presence enter the snapshot, so a shared snapshot cannot leak secrets.
- **Read-only build**: `dist/index.html` (double-click / file://) renders with all action buttons disabled and a "modo solo lectura — use `serve`" hint.
- **Structured errors**: the API returns `{ error, detail }`, the UI toasts, and partial writes never happen.

### Known limitation — MCP toggle vs Claude Code

Toggling an MCP writes `"enabled": false` (opencode semantics) into `opencode.jsonc` / `.mcp.json`. **Claude Code ignores the `enabled` key in `.mcp.json`** (flagged during Phase 5): a disabled MCP still loads in Claude Code until it is removed from the file or the session config. OpenCode honors `enabled`. The toggle is therefore fully effective on OpenCode harnesses and display-only for Claude Code consumers.

## Development

- `window.__hmGraph` — test hook exposed by the Grafo tab: `{ nodes, first() }` where `nodes` is the visible node count of the last update and `first()` returns the first visible node id + canvas-relative position (drives synthetic click tests).
- `window.__HM_SERVE__` / `window.__HM_ROOT__` — injected by the server into the served HTML so the UI knows it is in serve mode (actions enabled) and which root it points at.
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
