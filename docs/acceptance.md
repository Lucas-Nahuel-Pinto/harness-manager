# harness-manager — Manual Acceptance Checklist

**Spec source:** `docs/superpowers/specs/2026-10-07-harness-manager-design.md` §10 (success criteria).
**Scope:** executed against **both** real harnesses. One section per harness; every item is a checkbox for **user visual sign-off** — nothing is pre-ticked.

## How to run

```bash
# Harness A — QA boilerplate
bun run pull --root "C:\Agentic-Quality-Engineer\Projects\bunkai\bunkai-qa-engineering-lpinto"
bun run serve --root "C:\Agentic-Quality-Engineer\Projects\bunkai\bunkai-qa-engineering-lpinto"

# Harness B — agentic-pm-harness
bun run pull --root "C:\Agentic-Quality-Engineer\Projects\jira-traceability\agentic-pm-harness"
bun run serve --root "C:\Agentic-Quality-Engineer\Projects\jira-traceability\agentic-pm-harness"

# Direct engine (no launcher, no start/stop buttons — Ctrl+C to stop)
bun run engine --root "C:\path\to\harness"
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

## Launcher control (Phase 5.5)

Applies to whichever harness was launched with `bun run serve` (launcher on `127.0.0.1:7397`).

| # | Check | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| L1 | Launcher entry | `bun run serve --root <root>` opens `http://127.0.0.1:7397/`; header shows the status dot + **Detener servidor** (engine already running after the build) | [ ] | |
| L2 | Stop keeps page alive | **Detener servidor** → toast "servidor detenido — la vista queda en solo lectura"; the page stays on the last snapshot; dot turns red; actions (toggle/run/model/Re-scan) disable with the hint | [ ] | |
| L3 | Start re-enables actions | **Iniciar servidor** → toast "servidor iniciado" + fresh snapshot in place (no reload); dot green; actions work again (e.g. toggle an MCP end-to-end) | [ ] | |
| L4 | Restart cycle | L2 → L3 works at least twice without reloading the page; `GET /api/status` always matches the dot | [ ] | |
| L5 | file:// fallback | Open `dist/index.html` via file:// → **Iniciar servidor** probes the launcher: reachable → "Abrir en el launcher" offer; not reachable → modal with copyable `bun run serve --root …` command | [ ] | |
| L6 | Direct engine unchanged | `bun run engine --root <root>` → own UI on a dynamic port with NO start/stop buttons; badge "modo serve · escritura"; Ctrl+C stops it | [ ] | |
| L7 | No orphans | After stopping the engine from the UI, `tasklist` shows no leftover `bun server.ts` PID for that root | [ ] | |

---

## Cross-cutting (both harnesses)

| # | Check | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| C1 | Quality gates | `bun run repo:check` green (format → lint → types → 85 tests) | [ ] | |
| C2 | Build | `bun run build` green; `dist/index.html` single-file, double-clickable | [ ] | |
| C3 | Fail-safe | A failing scan does not overwrite `data/harness.json` (covered by `pull-failsafe` tests) | [ ] | |
| C4 | Loopback | Launcher (7397) and engine (dynamic port) listen on `127.0.0.1` only (printed URLs) | [ ] | |
| C5 | No env values | No `.env` value appears in snapshot, UI, diff, or test output | [ ] | |
| C6 | MCP limitation | README documents that Claude Code ignores `enabled` in `.mcp.json` (toggle is OpenCode-effective) | [ ] | |
| C7 | Sanitization | `git grep` for user-specific absolute paths in tracked files → only intentional/functional hits remain | [ ] | |
| C8 | Visual sign-off | User has personally viewed all 6 tabs on both harnesses | [ ] | |

---

## Online mode (Phase 4)

Applies after the Cloudflare deploy (Pages + relay Worker). **L1–L7 (launcher/local checklist) are unchanged by online mode** and remain the local-mode sign-off.

| # | Check | Expected observation | Done | Notes |
| --- | --- | --- | --- | --- |
| L8 | Pairing URL | `bun run online --root <root>` prints `Online: https://<project>.pages.dev/#c=<CODE>` next to the local URL (relay connected) | [ ] | |
| L9 | Pairing screen | Opening the Pages origin WITHOUT `#c=` shows the pairing screen; pasting the full pairing URL (or the bare code) joins the room | [ ] | |
| L10 | Second network | A phone on a different network opens the pairing URL → snapshot renders over the relay | [ ] | |
| L11 | Staged action | ONE staged action over the relay (e.g. MCP toggle or Re-scan) → diff shown → confirm → applied → re-scan reflects it | [ ] | |
| L12 | Offline + reconnect | Stop the engine → UI shows the offline banner; restart the engine → new pairing URL printed, pasting it reconnects (old room is dead) | [ ] | |

**Sign-off**

| Role | Name | Date | Done |
| --- | --- | --- | --- |
| User | | | [ ] |
