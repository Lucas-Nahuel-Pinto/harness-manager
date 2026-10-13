# harness-manager — Manual Acceptance Checklist

**Spec source:** `docs/superpowers/specs/2026-10-07-harness-manager-design.md` §10 (success criteria).
**Scope:** executed against **both** real harnesses. One section per harness; every item is a checkbox for **user visual sign-off** — nothing is pre-ticked.

**Status:** ✅ **APPROVED** — full user sign-off by Lucas-Nahuel-Pinto on 2026-10-13: Harness A · Harness B · Cross-cutting · Local L1–L7 · Online L8–L16b (incl. L16a/L16b) · Catalog L17–L19 · Desktop L20–L21.

## How to run

```bash
# 1 — open the hosted app (site-generated flow):
#     https://harness-manager.lucas-pinto.workers.dev
# 2 — copy the shown command `bun agent.ts <CODE>` and run it on the PC that holds the harness
# 3 — pick the root ON THE WEBSITE (recents / native dialog / manual path)

# Harness A — QA boilerplate (root picked on the site)
C:\Agentic-Quality-Engineer\Projects\bunkai\bunkai-qa-engineering-lpinto

# Harness B — agentic-pm-harness
C:\Agentic-Quality-Engineer\Projects\jira-traceability\agentic-pm-harness

# Agent-generated flow (double-click / terminal): prints the pairing URL to open
bun agent.ts

# Local diagnostic without relay (API only, no UI):
bun run engine --root "C:\path\to\harness" --port 7399
```

---

## Harness A — QA boilerplate

Root: `C:\Agentic-Quality-Engineer\Projects\bunkai\bunkai-qa-engineering-lpinto`

### Expected snapshot counts (Resumen KPIs)

| KPI | Expected | Done | Notes |
| --- | --- | --- | --- |
| Skills | 44 | [x] | |
| Comandos | 10 | [x] | |
| Agentes | 13 | [x] | |
| MCPs | 4 | [x] | |
| Env vars | 32 | [x] | |
| Scripts | 68 | [x] | |
| Registros | 3 | [x] | |

### Per-tab expected observations

| # | Tab | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| A1 | Resumen | KPI grid matches the table above; snapshot freshness + root path + `manifest` flag in the summary line | [x] | |
| A2 | Resumen | Health column **H** (Documentos): `AGENTS.md ✓`, `README.md ✓` (boilerplate has both) | [x] | |
| A3 | Resumen | Health column **I** (CI): workflow chips for the 4 GitHub workflows, `Husky ✓` | [x] | |
| A4 | Resumen | Health column **J** (Tests y gates): `test/lint/types ✓`, stale-registry count, snapshot warning count | [x] | |
| A5 | Resumen | **Drill-down H**: click the H card → detail panel lists `AGENTS.md (o CLAUDE.md)` and `README.md` with paths + presente/ausente chips | [x] | |
| A6 | Resumen | **Drill-down I**: click the I card → workflow list with `.github/workflows/<name>` paths + husky status | [x] | |
| A7 | Resumen | **Drill-down J**: click the J card → gate scripts with commands, stale registries (if any), full-text snapshot warnings | [x] | |
| A8 | Skills + Commands | 44 skills sortable by tier/refs/evals/state; 10 commands section; click row → detail with triggers/refs/scripts | [x] | |
| A9 | Agents & Modelos | 13 agents; main agent marked; `model` column populated from frontmatter; catalog models in picker | [x] | |
| A10 | MCPs + Env | 4 MCP cards (config file, enabled chip, env refs); env matrix shows 32 vars with `.env.example`/`.env` presence, no values anywhere | [x] | |
| A11 | Scripts + Registros | 68 scripts listed with commands; 3 registries with status/staleness | [x] | |
| A12 | Grafo | Graph renders from the snapshot; filters narrow without orphaning context; selection illuminates edges; revisiting same filters is instant (cache) | [x] | |
| A13 | Shell | Left filter panel and right detail panel collapse/expand (`«`/`»`); search (`/`) filters Skills tab; warning badge opens warnings | [x] | |

### Action walkthroughs (online mode)

| # | Action | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| A15 | Toggle MCP | Pick an MCP → toggle → **unified diff shown** → confirm → file rewritten → auto re-scan reflects new enabled state → undo with a second toggle | [x] | |
| A16 | Run script | Run `skills:registry` (or any declared script) → output appears in the output pane; arbitrary commands are impossible from the UI | [x] | |
| A17 | Set subagent model | Pick a subagent → choose catalog model → diff of frontmatter `model:` shown → confirm → re-scan shows new model | [x] | |
| A18 | Copy path | Detail panel "Copiar ruta" copies `<root>/<relative path>` to clipboard | [x] | |
| A19 | Re-scan | "Re-scan" button refreshes snapshot + freshness without restart | [x] | |
| A20 | Safety | Path-escape / non-whitelisted script rejection still covered by `bun test` (guard + script-run tests green) | [x] | |

---

## Harness B — agentic-pm-harness

Root: `C:\Agentic-Quality-Engineer\Projects\jira-traceability\agentic-pm-harness`

### Expected snapshot counts (Resumen KPIs)

| KPI | Expected | Done | Notes |
| --- | --- | --- | --- |
| Skills | 7 | [x] | |
| Comandos | 0 | [x] | |
| Agentes | 0 | [x] | |
| MCPs | 4 | [x] | |
| Env vars | 7 | [x] | |
| Scripts | 2 | [x] | |
| Registros | 0 | [x] | |

### Per-tab expected observations

| # | Tab | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| B1 | Resumen | KPI grid matches the table above (0 commands / 0 agents / 0 registries render as `0`, not errors) | [x] | |
| B2 | Resumen | Health columns H/I/J reflect this harness's docs, CI and gates (observe actual state; H-J are informational) | [x] | |
| B3 | Resumen | Drill-downs H/I/J show itemized lists for this harness (missing docs / no workflows → explicit "ausente"/"ninguno" states, no crashes) | [x] | |
| B4 | Skills + Commands | 7 skills; commands section shows the empty state ("Sin comandos en este snapshot") | [x] | |
| B5 | Agents & Modelos | Empty agent state renders cleanly (no rows, no picker) | [x] | |
| B6 | MCPs + Env | 4 MCP cards; 7 env vars with presence-only matrix (no values) | [x] | |
| B7 | Scripts + Registros | 2 scripts; registries section shows the empty state | [x] | |
| B8 | Grafo | Graph renders the smaller element set; filters + selection work | [x] | |
| B9 | Shell | Collapse, search and warning badge behave as in Harness A | [x] | |

### Action walkthroughs (online mode)

| # | Action | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| B10 | Toggle MCP | Toggle an MCP in `opencode.jsonc` → diff → confirm → re-scan reflects it → toggle back | [x] | |
| B11 | Run script | Run one of the 2 declared scripts → output captured; undeclared name rejected | [x] | |
| B12 | Copy path | "Copiar ruta" works for a skill detail | [x] | |
| B13 | Re-scan | "Re-scan" refreshes the snapshot in place | [x] | |

---

## Local side — headless agent

Applies to the agent flow (web picker driving `bun agent.ts`).

| # | Check | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| L1 | Agent-generated flow | `bun agent.ts` (no code) prints `Online: https://harness-manager.lucas-pinto.workers.dev/#c=<CODE>` and the "agente en pie" line; Ctrl+C stops it | [x] | |
| L2 | Paste fallback | Opening the printed URL (or pasting the code into the launcher screen) joins the room and shows the picker | [x] | |
| L3 | No local UI | While the agent runs, nothing listens on any local port (only outbound WS to the relay); no window opens | [x] | |
| L4 | Invalid code | `bun agent.ts NOT-A-CODE` exits 1 with the usage message | [x] | |
| L5 | Offline relay | Relay unreachable → the agent logs the outage once and keeps retrying; site shows "esperando agente" | [x] | |
| L6 | Diagnostic engine | `bun run engine --port 7399` serves `/api/snapshot` (200) and 404s every non-API path (no HTML) | [x] | |
| L7 | No orphans | Ctrl+C the agent → its room goes silent (offline banner in the site); no leftover `bun` processes for that root | [x] | |

---

## Cross-cutting (both harnesses)

| # | Check | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| C1 | Quality gates | `bun run repo:check` green (format → lint → types → test) | [x] | |
| C2 | Online build | `bun run build:online` green; `dist-online/` single-file, embeds ZERO harness data | [x] | |
| C3 | Fail-safe | A failing scan does not overwrite `data/harness.json` (covered by `pull-failsafe` tests) | [x] | |
| C4 | No inbound ports | The agent only opens an outbound WS to the relay; the diagnostic engine binds `127.0.0.1` only | [x] | |
| C5 | No env values | No `.env` value appears in snapshot, UI, diff, or test output | [x] | |
| C6 | MCP limitation | README documents that Claude Code ignores `enabled` in `.mcp.json` (toggle is OpenCode-effective) | [x] | |
| C7 | Sanitization | `git grep` for user-specific absolute paths in tracked files → only intentional/functional hits remain | [x] | |
| C8 | Visual sign-off | User has personally viewed all 6 tabs on both harnesses | [x] | |

---

## Online mode (launcher screen + web picker)

Applies after the Cloudflare deploy (hosted UI on Workers static assets + relay Worker). See spec `2026-10-11-web-picker-agent-design.md`.

| # | Check | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| L8 | Launcher screen | Hosted origin without `#c=` shows the launcher: `bun agent.ts <CODE>` command + copy button + "esperando agente" status | [x] | |
| L9 | Site-generated pairing | Running the shown command on the PC → the site advances to the picker WITHOUT reloading (same fragment/room) | [x] | |
| L10 | Web picker | Picker shows recents (after the first pick) · **Elegir carpeta…** opens the native OS dialog on the AGENT's machine · manual absolute path works everywhere | [x] | |
| L11 | Pick → dashboard | Pick a valid root → dashboard renders over the relay with the snapshot of that root. Accented/`ñ` path works on Windows | [x] | |
| L12 | Validation | Relative path / missing path / a plain file → inline 400 detail in the picker, still on the picker, recents untouched. Linux without zenity/kdialog → browse errors with hint, manual input still works | [x] | |
| L13 | Second network | A phone on a different network opens the same `#c=` URL → picker/dashboard over the relay | [x] | |
| L14 | Staged action | ONE staged action over the relay (MCP toggle or Re-scan) → diff shown → confirm → applied → re-scan reflects it | [x] | |
| L15 | Rebind | While running, pick a different root from the site → dashboard switches to the new root without restarting the agent | [x] | |
| L16 | Offline + reconnect | Ctrl+C the agent → offline banner; rerun the same command → reconnects to the same room, state recovers | [x] | |
| L16a | Agent gone while picker open | Kill the agent while the picker shows → status turns "agente desconectado", browse/manual controls freeze, **Elegir carpeta…** errors instantly (no silent hang); rerun the same command → controls restore | [x] | |
| L16b | Dead-session reload | Reload the hosted page with `#c=` while the agent is gone → "Reconectando tu sesión…" then the launcher screen with the SAME command (never the empty dashboard); rerun the command → picker/dashboard over the same room | [x] | |

**Sign-off**

| Role | Name | Date | Done |
| --- | --- | --- | --- |
| User | Lucas-Nahuel-Pinto | 2026-10-13 | [x] |

---

## Model catalog (ownership)

Applies after the catalog-ownership phase (fetch moved from the boilerplate into harness-manager).

| # | Check | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| L17 | Shared-store refresh | Aging or deleting the engine-side catalog store (`data/models.catalog.json` / `MODELS_CATALOG_PATH`) + Re-scan → store rewritten atomically (`fetchedAt` updated, `sources` populated), model picker serves the refreshed list, model-set validates against it | [x] | Re-scoped 2026-10-13 (shared store, option B); covered by `tests/catalog-refresh.test.ts` |
| L18 | Harness root never written | Scanning any harness (bare minimal root included) refreshes only the engine-side store — no `.models.catalog.json` ever appears inside the harness root; a leftover per-harness catalog file is ignored | [x] | Re-scoped 2026-10-13; covered by `tests/catalog-refresh.test.ts` |
| L19 | Degraded fetch | With sources unreachable, the old store stays intact, the snapshot carries a refresh warning, and the rescan still succeeds | [x] | |

**Sign-off**

| Role | Name | Date | Done |
| --- | --- | --- | --- |
| User | Lucas-Nahuel-Pinto | 2026-10-13 | [x] |

---

## Desktop entry (double-click)

Applies after the desktop-entry scripts (`start-harness-manager.bat` / `.sh` → `bun agent.ts` with no code).

| # | Check | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| L20 | Windows | Double-click `start-harness-manager.bat` → terminal prints the pairing URL; opening it shows the picker; pick via recents/dialog/manual works | [x] | |
| L21 | POSIX | `start-harness-manager.sh` on Linux or macOS (`.command` rename or `.desktop` launcher): prints the URL, pick via manual input starts the flow (native dialog when zenity/kdialog present) | [x] | |
