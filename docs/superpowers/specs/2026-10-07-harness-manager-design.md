# harness-manager — Design

Date: 2026-10-07
Status: approved (brainstormed with user, all sections OK)
Repo: `Lucas-Nahuel-Pinto/harness-manager` (private until sanitized)

## 1. Goal

A panoramic dashboard to **visualize and manage the elements of any agent harness**, following the proven `jira-traceability-manager` (JTM) pattern: snapshot pipeline + self-contained single-file app, plus a local server layer that enables real management actions.

Unlike JTM (read-only over Jira), this tool also **writes**: toggles MCPs, runs harness scripts, assigns AI models — always through diff + confirmation.

## 2. Scope (v1)

### In inventory + management (A-G)

| # | Element | Sources |
|---|---------|---------|
| A | Skills | `.claude/skills/`, `.agents/skills/`, `SKILL.md` frontmatter, `references/`, `scripts/`, `evals/` |
| B | Commands | `.claude/commands/*.md` |
| C | Agents + models | `.opencode/agents/*.md`, `.claude/agents/*.md` (frontmatter `model:`) |
| D | MCPs | `opencode.jsonc`, `.mcp.json` (enabled state, env refs) |
| E | Env vars | `.env.example` vs `.env` — names and presence ONLY, never values |
| F | Scripts/CLI | `package.json` scripts, `cli/`, `scripts/` |
| G | Registries | `REGISTRY.md`, `kata-manifest.json`, `.models.catalog.json` |

### Health columns only, no actions (H-J)

- **H** Rules/docs: `AGENTS.md`, `README.md`
- **I** CI workflows: `.github/workflows/`, husky hooks
- **J** Tests/gates: test, lint, typecheck configured

### Management actions (v1)

| ID | Action | Writes |
|----|--------|--------|
| A | Toggle MCP on/off | `opencode.jsonc` / `.mcp.json` |
| B | Run harness script | none (executes declared `package.json` scripts, captures output) |
| C | Open element | none (copy absolute path + best-effort OS-open of files inside root) |
| F | Assign AI model to main agent / subagents | agent frontmatter `model:` + main-session model config |

### Out of scope (v1)

- Scaffold new skills/commands (D)
- Any write to `.env` or env values (E — presence report only)
- Editing AGENTS.md / docs (H-J stay read-only health)
- TMS/Jira integration (this tool reads harness directories, not Jira)

## 3. Detection model — auto-detect + optional manifest

Default: scan well-known paths (`.claude/skills/`, `.claude/commands/`, `.opencode/agents/`, `.mcp.json`, `opencode.jsonc`, `.env.example`, `package.json`, `.agents/`). Works out-of-the-box on the QA boilerplate and on `agentic-pm-harness`.

Optional `harness.json` in the target root declares non-standard locations:

```jsonc
{
  "skills": ["custom/path/*/SKILL.md"],
  "models": {
    "main": { "file": "opencode.jsonc", "jsonPath": "model" },
    "subagents": { "glob": ".opencode/agents/*.md", "field": "model" },
    "catalog": ".models.catalog.json"
  }
}
```

Auto-detection supplies sane defaults for every section; the manifest only overrides/extends.

## 4. Architecture

```
harness root --scan--> src/scan/ --> data/harness.json (ajv-validated, atomic write)
                                         |
                        +----------------+----------------+
                        |                                 |
                     build                            serve
                        |                                 |
                 dist/index.html                   server.ts (loopback)
                 read-only mode                    GET  /api/snapshot
                 (double-click, share)             POST /api/action
                                                   (diff -> confirm -> apply -> re-scan)
```

- **Snapshot fail-safe**: a scan that errors, is empty, or fails schema validation never overwrites the last good `data/harness.json` (JTM lesson).
- **Single-file build**: same Vite + `vite-plugin-singlefile` pipeline as JTM; embedded snapshot; all action buttons disabled with a "read-only mode — use `serve`" hint.
- **Serve mode**: Bun server on `127.0.0.1` (random port by default, overridable). Serves the built UI + JSON API.

## 5. Data model

```ts
HarnessSnapshot {
  meta      { root, scannedAt, toolVersion, manifest? }
  skills    { name, tier T1-T4, path, triggers[], refs[], scripts[], registered }
  commands  { name, path, description }
  agents    { name, path, host opencode|claude, model, description, isMain? }
  mcps      { name, configFile, enabled, envRefs[] }
  env       { name, inExample, inEnv }
  scripts   { name, command }
  registries{ name, path, kind, entries, stale? }
  health    { docs, ci, tests }
  catalog   { models[] }
}
```

Rules:

- Stable ID = `kind + relative path` (survives display renames).
- Env values are never read into the snapshot — snapshot is safe to share.
- Actions are NOT embedded in the snapshot; the server computes them per request (a stale `dist/index.html` never shows obsolete buttons).

## 6. UI — 6 tabs

Shell mirrors JTM: collapsible left filter panel, tabs on top, collapsible right detail panel, server-mode badge with snapshot freshness.

| Tab | Content |
|-----|---------|
| Resumen | KPI counts + health columns H-J + snapshot freshness |
| Skills + Commands | sortable table (tier, refs, triggers, state), detail with Open / Run-registry actions |
| Agents & Modelos | main agent + subagent table with current model; model picker (catalog) + diff + confirm (action F) |
| MCPs + Env | MCP cards with toggle (action A); env presence matrix (E, read-only) |
| Scripts + Registros | script runner (action B, output pane); registry status/staleness |
| Grafo | Cytoscape + fcose relational graph: skill → references → scripts, agent → skills; position cache per filter set (JTM pattern) |

## 7. Safety and error handling

- **Diff + confirm always**: server computes unified diff → UI shows it → apply only on confirm → atomic write (temp + rename) → automatic re-scan.
- **Confined writes**: every resolved path must stay inside the harness root (path-traversal guard).
- **Bounded script runner**: only scripts declared in the target harness `package.json`, `cwd = root`, output captured and streamed to the UI. The UI never sends arbitrary command strings.
- **`.env` untouchable**: actions only touch MCP config, agent frontmatter/session model config, and script execution.
- **Read-only build**: action buttons disabled in `dist/index.html` mode.
- **Structured errors**: API returns `{ error, detail }`; UI toasts; never applies partial writes.
- **MCP/auth failure of the server itself**: STOP and surface, no workarounds.

## 8. Testing and quality gates

- `bun test`:
  - scanner fixtures (harness with/without manifest, malformed skill, missing dirs)
  - action units (toggle produces expected diff; path escape rejected; model assignment rewrites frontmatter correctly)
  - server API (snapshot GET, action POST happy-path + confirm-required + rejection)
- Gates: `bun run types:check`, `bun run lint`, `bun test` — a local `repo:check`.
- Manual acceptance: run `serve` against the QA boilerplate and against `agentic-pm-harness`.

## 9. Repository and delivery

- Local: `<repo-root>` (developer-machine checkout; absolute path intentionally omitted for publication)
- GitHub: `Lucas-Nahuel-Pinto/harness-manager`, **private** until a final anti-BK sanitization pass, then publishable as a portfolio piece.
- Stack (mirrors JTM): Bun + TypeScript, Vite + singlefile, cytoscape + cytoscape-fcose, ajv, `@antfu/eslint-config`, Prettier.
- License: MIT.
- Commands: `bun run pull` · `bun run build` · `bun run serve` · `bun test` · `bun run types:check` · `bun run lint`.

## 10. Success criteria

1. `bun run pull` against either real harness produces a valid snapshot covering A-G + H-J.
2. `bun run build` yields a double-clickable read-only `dist/index.html`.
3. `bun run serve` lets the user toggle an MCP, run a script, and change a subagent model — each with visible diff + confirmation — and the re-scan reflects it.
4. All quality gates green.
