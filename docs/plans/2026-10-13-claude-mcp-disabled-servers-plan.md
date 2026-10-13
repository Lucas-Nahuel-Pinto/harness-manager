# Claude-Effective MCP Toggle — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-13-claude-mcp-disabled-servers-design.md` · **Gate:** `bun run repo:check` green · **Single phase — everything ships together** (engine, scan, UI hint, docs are one behavior change; a partial ship would let the dashboard lie in between)

## Phase 1 — `.mcp.json` toggle goes through `.claude/settings.json`

1. `src/actions/locate.ts` — NEW exported `rootEnd(text): number | null`: end offset of the root `{...}` object, reusing the existing comment/string-aware scanner (never-match target, `scanValue` return value).
2. `src/actions/mcp-toggle.ts`:
   - Extract the existing entry-validation preamble (unchanged error codes).
   - `configFile === '.mcp.json'` → read + validate `.claude/settings.json` (missing → absent; invalid JSON / non-array or non-string `disabledMcpjsonServers` / non-object root → `400 config_invalid`); compute `inDisabled`, `legacyMarker`, `currentEnabled`; no-op check with the standard `(sin cambios)` summary.
   - Disable → `insertDisabledSetting` (create file scaffold / insert first root property with comma rules / insert element after `[` with comma rules).
   - Enable → in array: `removeDisabledSetting` (element removal with comma repair; whole-key removal when the array empties, reusing the generalized `removeEnabledKey` with the leading-newline eat for the only-property case); else legacy marker → existing marker-removal path.
   - Validation: reparse + deepEqual against the expected structure (settings with the array modified), same safety net as the marker path.
   - `configFile === 'opencode.jsonc'` → verbatim existing marker path.
3. `src/scan/agents.ts` — `scanMcps`: when `.mcp.json` ∈ scanned files, load `.claude/settings.json` once; parse/validation errors → `warnings.push(...)` (state unaffected); `enabled` = legacy marker AND not listed in `disabledMcpjsonServers`.
4. `src/views/mcp-env.ts` — `CLAUDE_HINT` reworded (toggle writes `disabledMcpjsonServers` in `.claude/settings.json`); visible hint text updated accordingly.
5. `README.md` — "Known limitation — MCP toggle vs Claude Code" → "MCP toggle semantics": marker for `opencode.jsonc`, `disabledMcpjsonServers` for `.mcp.json`, legacy markers still honored and stripped on enable.
6. Tests:
   - `tests/mcp-toggle.test.ts` — rewrite the `.mcp.json` suite (cases in spec §6); keep every `opencode.jsonc` suite untouched.
   - `tests/scan.test.ts` — tmp copy of mini-harness + settings file cases (spec §6).
   - `tests/api-staged.test.ts` — one staged `.mcp.json` case: stage-1 diff targets `.claude/settings.json`, no file touched; stage-2 applies + snapshot flips.
7. Dead-reference scan — the old claim "Claude Code no lee `enabled` aquí" / "display-only" wording across `src/ tests/ docs/ README.md` must come back clean (historical acceptance/spec docs excepted).
8. `verify:` `bun run repo:check` green (format + lint + types + relay types + full test suite) · manual sanity: compute a disable on a fixture with a `.claude/settings.json` containing comments → comments survive.

**Commit:** `feat: honor Claude Code MCP toggles via disabledMcpjsonServers`

## Risks

- **Roundtrip byte-exactness on settings edits** — the new splice rules (first-property insert, element insert/remove, whole-key removal) must restore original bytes on disable→enable; the rewritten suite asserts both pre-existing and pre-absent key roundtrips.
- **Legacy-marker divergence** — a harness with an old `enabled: false` marker keeps showing disabled until an enable strips it; scan honors both sources so display and Claude Code agree in every reachable state.
- **Only-property key removal** — the generalized `removeEnabledKey` gains a trailing-newline eat that fires only for an only-property key (no comma either side); existing marker tests never hit that shape, validation deepEquals every candidate.
- **`.claude/` directory creation** — `atomicWrite` needs the parent dir when the settings file is created; the toggle ensures `.claude/` exists before apply (the file is written by the standard staged apply path).
