# Implementation Plan — harness-manager

**Date:** 2026-10-07
**Spec:** `docs/superpowers/specs/2026-10-07-harness-manager-design.md` (approved)
**Convention:** Phase → Code → Verify. Every phase ends with a green gate before the next starts. Semantic commits (`feat:`/`fix:`/`docs:`/`test:`/`chore:`), one responsibility each, no AI attribution, **no push** without user confirmation (repo is private until sanitization).

---

## Phase 1 — Scaffold

**Tasks**

1. `package.json` scripts: `pull`, `build`, `serve`, `dev`, `test`, `types:check`, `lint`, `lint:fix`, `format:check`, `format:fix`, `repo:check`.
2. Dependencies (mirror JTM): `cytoscape`, `cytoscape-fcose`; dev: `vite`, `vite-plugin-singlefile`, `typescript`, `eslint` + `@antfu/eslint-config`, `prettier`, `@types/bun`, `ajv`.
3. `tsconfig.json` strict, `eslint.config.js`, `.prettierrc`, `vite.config.ts` + singlefile.
4. `AGENTS.md` short: pipeline commands, fail-safe rule (`data/harness.json` + `dist/index.html` are generated — never hand-edit), writes confined to harness root, no env values ever read.
5. README stub update (commands table placeholder).
6. No `.env` needed — the scanner reads only files in the target harness (note this as a feature).

**Verify:** `bun install` → `types:check` + `lint` green with a placeholder `src/main.ts`; `bun run build` emits `dist/index.html`.

## Phase 2 — Scan layer + snapshot pipeline

**Tasks**

1. `harness.schema.json` — contract for `HarnessSnapshot` (spec §5), `schemaVersion: 1`.
2. `src/scan/` one module per element group:
   - `skills.ts` (frontmatter: name, description, tier inference T1-T4, triggers, references/scripts/evals file lists, `REGISTRY.md` membership → `registered`)
   - `commands.ts`, `agents.ts` (host = `.opencode/` vs `.claude/`, frontmatter `model`, main-agent detection), `mcps.ts` (parse `opencode.jsonc` + `.mcp.json`, enabled state, env refs), `env.ts` (presence only: `.env.example` vs `.env`), `scripts.ts` (`package.json`), `registries.ts` (entries + staleness vs live scan), `health.ts` (H-J), `catalog.ts` (`.models.catalog.json`).
3. `src/scan/manifest.ts` — load optional `harness.json` from target root: path overrides + models config (spec §3); defaults applied when absent.
4. `src/scan/index.ts` — orchestrator: root resolution (`--root` / `HARNESS_ROOT` / cwd), tolerant scan (missing dirs = empty, malformed skill = warning row, never crash), stable IDs.
5. `scripts/pull.ts` — scan → ajv validate → atomic write `data/harness.json`; **fail-safe: error/empty/invalid never overwrites last good snapshot** (abort by name).
6. `bun test` fixtures: `tests/fixtures/harness-boilerplate/` (mini clone with skills+commands+agents+mcp+env+package), `harness-minimal/` (no manifest, few dirs), `harness-broken/` (malformed skill, bad JSON config) + fail-safe tests.

**Verify:** `bun run pull --root <boilerplate>` and `--root <agentic-pm-harness>` produce valid snapshots with counts > 0 for every present group; `bun test` green; simulated invalid scan does NOT modify the previous snapshot file.

## Phase 3 — UI shell + read-only tabs (5 of 6)

**Tasks**

1. `src/model.ts` selectors over snapshot (filter by tier/state, search, health rollup), `src/state.ts` global state (active tab, filters, search, selected element).
2. `src/main.ts` shell: top bar (root path, snapshot freshness, server badge), 6 tab buttons (Grafo tab disabled/placeholder until Phase 4), collapsible left filter + right detail panels (JTM `«`/`»` pattern).
3. Views: `resumen.ts` (KPI counts + H-J health columns), `skills.ts` (table + commands section, sortable columns), `agents.ts` (model column read-only for now), `mcp-env.ts` (MCP cards read-only + env presence matrix), `scripts-registry.ts` (script list + registry status).
4. `src/components/detail-panel.ts` — element detail: path, metadata, refs, copy-path button (action C copy half).
5. Snapshot injection into build (same JTM mechanism) so `dist/index.html` is self-contained.

**Verify:** `bun run build` from a real boilerplate snapshot → double-click `dist/index.html`: 5 tabs render with real counts, filters/search/detail work, collapsibles work.

## Phase 4 — Grafo tab

**Tasks**

1. `src/views/graph.ts` — Cytoscape + **fcose** with per-filter position cache and pre-layout overlay (JTM lesson: never block 30s on `cose`).
2. Elements: skills/commands/agents/MCPs/scripts as nodes, edges = references (skill→refs, skill→scripts, agent→skill triggers, MCP→env refs).
3. Filter scope = matching elements ∪ their ancestors (JTM `buildFilterScope` pattern); selection illumination (highlight incident edges, fade rest); click → detail panel.

**Verify:** graph renders from real snapshot; filters narrow without orphaning context; selection illuminates; revisiting same filters is instant (cache).

## Phase 5 — Server + management actions

**Tasks**

1. `server.ts` (Bun): serves UI + `GET /api/snapshot` + `POST /api/action`; binds `127.0.0.1` only; random port with override.
2. Core action engine `src/actions/`:
   - `diff.ts` — compute new file content → unified diff (pure, tested)
   - `guard.ts` — resolved target path must stay inside harness root (reject + test path escape)
   - `apply.ts` — atomic write (temp + rename) → triggers re-scan → returns fresh snapshot
   - `open.ts` — copy path (client) + best-effort OS-open of files inside root
3. Actions:
   - `mcp-toggle` — rewrite `opencode.jsonc` / `.mcp.json` (JSONC-preserving edit strategy: parse for computation, line-based replace to keep comments — document approach)
   - `script-run` — only script names present in target `package.json`; `cwd = root`; stdout/stderr streamed back (poll or SSE); never accepts arbitrary command strings
   - `model-set` — main agent (config file + jsonPath from manifest/models config) and subagents (frontmatter `model:` rewrite); catalog from `.models.catalog.json`
4. API contract: `POST /api/action { kind, target, payload }` → `{ diff }` (stage 1) → client re-sends with `confirm: true` → `{ ok, snapshot }` or `{ error, detail }`. Staged confirm = server-enforced diff+confirm, not just UI courtesy.
5. UI wiring: in serve mode (`?serve=1` injected by server) action buttons enabled; confirm modal shows unified diff; script output pane; after apply → snapshot refresh + toast.
6. Tests: guard path-escape, diff correctness, model-set rewrite, mcp-toggle roundtrip, API staged-confirm flow (reject without `confirm`).

**Verify:** `bun run serve` against boilerplate: toggle an MCP (diff shown, applied, re-scan reflects it), run `skills:registry` script (output visible), change a subagent model (frontmatter updated); `bun test` green; without `serve` the built HTML shows buttons disabled with the read-only hint.

## Phase 5.5 — Launcher start/stop (option B, user-requested)

**Context:** user asked for a UI button to start/stop the server (`bun run serve`). A browser cannot spawn processes, so the runtime splits in two.

**Tasks**

1. **Launcher** — `launcher.ts` + `src/launcher/app.ts`:
   - Fixed loopback port **7397** (`--port` / `HM_LAUNCHER_PORT`), serves the built UI forever; routes `GET /` (injects `window.__HM_LAUNCHER__=true;window.__HM_ROOT__`), `GET /api/status`, `POST /api/start`, `POST /api/stop`.
   - Engine spawn: `bun server.ts --root <root> --port 0` → parse `http://127.0.0.1:<port>` from stdout (≤5s) + poll `GET <url>/api/snapshot` until 200 (≤8s overall, else `spawn_failed` + kill child).
   - Kill: win32 `taskkill /pid <pid> /T /F`; posix SIGTERM → SIGKILL after 5s. Child-exit watcher flips status to `stopped`, keeps stderr tail on non-zero exit. Launcher `exit` hook kills a still-running engine (no orphans).
   - DI seam: `createLauncher(root, { spawnEngine, killEngine, distIndex })` → fully testable without processes.
2. **Engine CORS** (`src/server/cors.ts` + `src/server/app.ts`): `OPTIONS` → 204, `Access-Control-Allow-Origin: *` on every response — the launcher-origin page calls the engine cross-port.
3. **UI** (`src/serve.ts` `__HM_LAUNCHER__` + `engineBase`/`actionsEnabled()`, `src/server-control.ts`, `src/main.ts`): header control block (status dot + label + Iniciar/Detener), 3s status poll, engine URL from `status.engineUrl` is the source of truth for all API calls; engine stopped → actions disabled + hint, page stays on the last snapshot; start/stop toasts + in-place snapshot refresh (no reload). file:// mode: button probes `127.0.0.1:7397` (reachable → "Abrir en el launcher"; else copyable `bun run serve --root …` command modal). Direct engine mode unchanged (no buttons).
4. **Scripts**: `serve` → `bun run build && bun launcher.ts`; new `engine` → `bun server.ts`.
5. **Tests**: `tests/launcher.test.ts` (DI fakes: start/stop/already/spawn_failed/kill_failed/crash watcher/HTML inject/503 + engine CORS preflight) — suite independent of any build.

**Verify:** `repo:check` green; live smoke on a temp mini-harness copy: launcher serves `/` with `__HM_LAUNCHER__`, start → running + snapshot ok, stop → stopped + PID dead (`tasklist`), page alive after stop, restart cycle works; direct `bun run engine` unchanged.

## Phase 6 — Closeout + acceptance

**Tasks**

1. `repo:check` script chaining format/lint/types/test.
2. README final: setup, commands, tabs, action safety model, screenshots placeholder.
3. Health column detail views (H-J) — drill-down lists per column.
4. Manual acceptance checklist in `docs/acceptance.md` executed against **both** real harnesses (spec §10).
5. Sanitization pass before any future publish: no BK data, no env values, no absolute user paths in committed artifacts.

**Verify:** `bun run repo:check` green; acceptance checklist all ✅ with user visual sign-off on the 6 tabs.

---

## Risks / open points

- **JSONC-preserving edit** for `opencode.jsonc` (comments must survive a toggle) — implement line-based replace backed by parse-compare; if unreliable, fall back to `jsonc-parser` dependency (decide in Phase 5).
- **Main-session model location varies per harness** (opencode.jsonc vs harness-specific gitignored file) — manifest `models.main` covers non-standard cases; auto-default covers `opencode.jsonc`.
- **Script-run streaming**: start with request-response capture (poll), upgrade to SSE only if output is long.
