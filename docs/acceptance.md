# harness-manager — Manual Acceptance Checklist

**Spec source:** `docs/superpowers/specs/2026-10-07-harness-manager-design.md` §10 (success criteria).
**Scope:** executed against **both** real harnesses. One section per harness; every item is a checkbox for **user visual sign-off** — nothing is pre-ticked.

## How to run

```bash
# Harness A — QA boilerplate
bun run pull --root "C:\Agentic-Quality-Engineer\Projects\bunkai\bunkai-qa-engineering-lpinto"
bun run build
bun server.ts --root "C:\Agentic-Quality-Engineer\Projects\bunkai\bunkai-qa-engineering-lpinto"

# Harness B — agentic-pm-harness
bun run pull --root "C:\Agentic-Quality-Engineer\Projects\jira-traceability\agentic-pm-harness"
bun run build
bun server.ts --root "C:\Agentic-Quality-Engineer\Projects\jira-traceability\agentic-pm-harness"
```

Also verify the read-only build: double-click `dist/index.html` (file://) — action buttons must be disabled with the "modo solo lectura" hint.

---

## Harness A — QA boilerplate

Root: `C:\Agentic-Quality-Engineer\Projects\bunkai\bunkai-qa-engineering-lpinto`

### Expected snapshot counts (Resumen KPIs)

| KPI | Expected | Done | Notes |
| --- | --- | --- | --- |
| Skills | 44 | [ ] | |
| Comandos | 10 | [ ] | |
| Agentes | 13 | [ ] | |
| MCPs | 4 | [ ] | |
| Env vars | 32 | [ ] | |
| Scripts | 68 | [ ] | |
| Registros | 3 | [ ] | |

### Per-tab expected observations

| # | Tab | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| A1 | Resumen | KPI grid matches the table above; snapshot freshness + root path + `manifest` flag in the summary line | [ ] | |
| A2 | Resumen | Health column **H** (Documentos): `AGENTS.md ✓`, `README.md ✓` (boilerplate has both) | [ ] | |
| A3 | Resumen | Health column **I** (CI): workflow chips for the 4 GitHub workflows, `Husky ✓` | [ ] | |
| A4 | Resumen | Health column **J** (Tests y gates): `test/lint/types ✓`, stale-registry count, snapshot warning count | [ ] | |
| A5 | Resumen | **Drill-down H**: click the H card → detail panel lists `AGENTS.md (o CLAUDE.md)` and `README.md` with paths + presente/ausente chips | [ ] | |
| A6 | Resumen | **Drill-down I**: click the I card → workflow list with `.github/workflows/<name>` paths + husky status | [ ] | |
| A7 | Resumen | **Drill-down J**: click the J card → gate scripts with commands, stale registries (if any), full-text snapshot warnings | [ ] | |
| A8 | Skills + Commands | 44 skills sortable by tier/refs/evals/state; 10 commands section; click row → detail with triggers/refs/scripts | [ ] | |
| A9 | Agents & Modelos | 13 agents; main agent marked; `model` column populated from frontmatter; catalog models in picker | [ ] | |
| A10 | MCPs + Env | 4 MCP cards (config file, enabled chip, env refs); env matrix shows 32 vars with `.env.example`/`.env` presence, no values anywhere | [ ] | |
| A11 | Scripts + Registros | 68 scripts listed with commands; 3 registries with status/staleness | [ ] | |
| A12 | Grafo | Graph renders from the snapshot; filters narrow without orphaning context; selection illuminates edges; revisiting same filters is instant (cache) | [ ] | |
| A13 | Shell | Left filter panel and right detail panel collapse/expand (`«`/`»`); search (`/`) filters Skills tab; warning badge opens warnings | [ ] | |
| A14 | Read-only | `dist/index.html` opened via file:// shows "modo solo lectura", action buttons + Re-scan disabled | [ ] | |

### Action walkthroughs (serve mode)

| # | Action | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| A15 | Toggle MCP | Pick an MCP → toggle → **unified diff shown** → confirm → file rewritten → auto re-scan reflects new enabled state → undo with a second toggle | [ ] | |
| A16 | Run script | Run `skills:registry` (or any declared script) → output appears in the output pane; arbitrary commands are impossible from the UI | [ ] | |
| A17 | Set subagent model | Pick a subagent → choose catalog model → diff of frontmatter `model:` shown → confirm → re-scan shows new model | [ ] | |
| A18 | Copy path | Detail panel "Copiar ruta" copies `<root>/<relative path>` to clipboard | [ ] | |
| A19 | Re-scan | "Re-scan" button refreshes snapshot + freshness without restart | [ ] | |
| A20 | Safety | Path-escape / non-whitelisted script rejection still covered by `bun test` (guard + script-run tests green) | [ ] | |

---

## Harness B — agentic-pm-harness

Root: `C:\Agentic-Quality-Engineer\Projects\jira-traceability\agentic-pm-harness`

### Expected snapshot counts (Resumen KPIs)

| KPI | Expected | Done | Notes |
| --- | --- | --- | --- |
| Skills | 7 | [ ] | |
| Comandos | 0 | [ ] | |
| Agentes | 0 | [ ] | |
| MCPs | 4 | [ ] | |
| Env vars | 7 | [ ] | |
| Scripts | 2 | [ ] | |
| Registros | 0 | [ ] | |

### Per-tab expected observations

| # | Tab | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| B1 | Resumen | KPI grid matches the table above (0 commands / 0 agents / 0 registries render as `0`, not errors) | [ ] | |
| B2 | Resumen | Health columns H/I/J reflect this harness's docs, CI and gates (observe actual state; H-J are informational) | [ ] | |
| B3 | Resumen | Drill-downs H/I/J show itemized lists for this harness (missing docs / no workflows → explicit "ausente"/"ninguno" states, no crashes) | [ ] | |
| B4 | Skills + Commands | 7 skills; commands section shows the empty state ("Sin comandos en este snapshot") | [ ] | |
| B5 | Agents & Modelos | Empty agent state renders cleanly (no rows, no picker) | [ ] | |
| B6 | MCPs + Env | 4 MCP cards; 7 env vars with presence-only matrix (no values) | [ ] | |
| B7 | Scripts + Registros | 2 scripts; registries section shows the empty state | [ ] | |
| B8 | Grafo | Graph renders the smaller element set; filters + selection work | [ ] | |
| B9 | Shell | Collapse, search and warning badge behave as in Harness A | [ ] | |

### Action walkthroughs (serve mode)

| # | Action | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| B10 | Toggle MCP | Toggle an MCP in `opencode.jsonc` → diff → confirm → re-scan reflects it → toggle back | [ ] | |
| B11 | Run script | Run one of the 2 declared scripts → output captured; undeclared name rejected | [ ] | |
| B12 | Copy path | "Copiar ruta" works for a skill detail | [ ] | |
| B13 | Re-scan | "Re-scan" refreshes the snapshot in place | [ ] | |

---

## Cross-cutting (both harnesses)

| # | Check | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| C1 | Quality gates | `bun run repo:check` green (format → lint → types → 71 tests) | [ ] | |
| C2 | Build | `bun run build` green; `dist/index.html` single-file, double-clickable | [ ] | |
| C3 | Fail-safe | A failing scan does not overwrite `data/harness.json` (covered by `pull-failsafe` tests) | [ ] | |
| C4 | Loopback | Server listens on `127.0.0.1` only (printed URL) | [ ] | |
| C5 | No env values | No `.env` value appears in snapshot, UI, diff, or test output | [ ] | |
| C6 | MCP limitation | README documents that Claude Code ignores `enabled` in `.mcp.json` (toggle is OpenCode-effective) | [ ] | |
| C7 | Sanitization | `git grep` for user-specific absolute paths in tracked files → only intentional/functional hits remain | [ ] | |
| C8 | Visual sign-off | User has personally viewed all 6 tabs on both harnesses | [ ] | |

**Sign-off**

| Role | Name | Date | Done |
| --- | --- | --- | --- |
| User | | | [ ] |
