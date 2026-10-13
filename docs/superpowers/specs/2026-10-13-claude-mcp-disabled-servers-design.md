# Claude-Effective MCP Toggle — Design

**Date:** 2026-10-13 · **Status:** approved · **Scope:** harness-manager repo only
**Amends:** `2026-10-07-harness-manager-design.md` (D1 marker semantics) — the `"enabled": false` marker stays the OpenCode contract; `.mcp.json` gains the mechanism Claude Code actually honors.

## 1. Problem

Toggling an MCP writes `"enabled": false` into the entry, in both `opencode.jsonc` and `.mcp.json`. OpenCode honors that flag; **Claude Code has no `enabled` key in the `.mcp.json` schema and silently ignores it** (README "Known limitation", flagged during Phase 5). The dashboard shows "Deshabilitado" while Claude Code keeps connecting the server on every session — the toggle is display-only for every Claude Code harness.

The mechanism Claude Code honors is the `disabledMcpjsonServers` array in the project's `.claude/settings.json`: a name listed there is rejected before approval and never connected, and the rejection takes precedence over `enabledMcpjsonServers` / `enableAllProjectMcpServers`.

## 2. Goal

The `.mcp.json` toggle becomes effective for Claude Code: **disable** adds the server name to `disabledMcpjsonServers` in `.claude/settings.json` (creating file or key as needed); **enable** removes it. The snapshot's `enabled` state is computed from the same source, so the dashboard never lies again.

```
toggle targets
├─ opencode.jsonc ──► "enabled": false marker (unchanged — opencode honors it)
└─ .mcp.json ───────► .claude/settings.json → disabledMcpjsonServers (what Claude Code honors)
                       legacy "enabled": false marker inside .mcp.json → still read, still removable on enable
```

## 3. Binding decisions

1. **Single-file edit per action.** A `.mcp.json` toggle writes `.claude/settings.json` only. The `ComputedEdit` single-file contract, the atomic temp+rename write, and the "partial writes never happen" guarantee stay untouched — no multi-file pipeline.
2. **State model.** For a `.mcp.json` entry: `enabled = (entry.enabled !== false) && !disabledMcpjsonServers.includes(name)`. The entry-level marker is honored as **legacy** (harnesses toggled before this spec keep their state); `disabledMcpjsonServers` is the forward source of truth. `enabledMcpjsonServers` is never consulted — it cannot override a rejection in Claude Code's precedence.
3. **Disable** (currently enabled) → add `"name"` to `disabledMcpjsonServers`:
   - file missing → create `.claude/settings.json` containing `{\n  "disabledMcpjsonServers": ["name"]\n}\n`;
   - key missing → insert as FIRST root property (trailing comma when a property follows; trivia/comments elsewhere untouched — the same strategy as the `enabled` marker insert);
   - key present → insert the element right after `[` (comma after it, mirroring the marker insert rules for multiline vs single-line files).
   - legacy marker already present (server already shows disabled) → no-op, exactly like today's already-disabled case.
4. **Enable** (currently disabled):
   - name in `disabledMcpjsonServers` → remove the element; **when the array would empty, remove the whole `disabledMcpjsonServers` key** so a disable→enable roundtrip restores the original bytes whenever the key pre-existed absent; comma repair mirrors the marker removal (plus the leading-newline eat for the only-property case);
   - legacy marker only (not in the array) → existing marker-removal path on `.mcp.json`;
   - both (hand-edited state — unreachable through our own flow, which never writes both) → array removal first, marker removal on the next toggle: deterministic and self-healing.
5. **Never rebuild `.claude/settings.json`.** Edits are surgical text splices using the existing `skipTrivia` / `locatePath` machinery plus a NEW `rootEnd(text)` helper in `locate.ts` (root `}` offset, comment/string-aware, built on the existing scanner). Every candidate edit is re-parsed and deep-compared against the expected structure before it can be returned — the same safety net the marker path uses.
6. **Strict validation, friendly errors.** Invalid JSON in `.claude/settings.json` → `400 config_invalid` (`.claude/settings.json: <parse error>`); `disabledMcpjsonServers` present but not an array of strings → `400 config_invalid`; settings root not an object → `400 config_invalid`.
7. **Scan reads the same source.** `scanMcps` loads `.claude/settings.json` once (only when `.mcp.json` is among the scanned config files), pushes a warning through the existing warning channel on parse/validation errors, and computes `enabled` per decision 2.
8. **UI hint updated, not removed.** The `.mcp.json` card hint becomes informational: the toggle writes `.claude/settings.json` (`disabledMcpjsonServers`). No client payload change — the server already branches on `configFile`.
9. **README limitation replaced by semantics.** "Known limitation — MCP toggle vs Claude Code" becomes "MCP toggle semantics" (both files + legacy marker). `docs/acceptance.md` C6 stays untouched as the historical Phase-5 record.

## 4. Components

| File | Change |
| --- | --- |
| `src/actions/mcp-toggle.ts` | `.mcp.json` branch routes to a `.claude/settings.json` edit: create file / insert first key / insert-remove element / remove key when the array empties; shared parse+deepEqual validation; existing marker path reused verbatim for `opencode.jsonc` and the legacy case |
| `src/actions/locate.ts` | NEW exported `rootEnd(text): number | null` — end offset of the root `{...}` object via the existing comment/string-aware scanner |
| `src/scan/agents.ts` | `scanMcps`: read `.claude/settings.json` once when `.mcp.json` is scanned; warn on invalid JSON / non-array / non-string entries; `enabled` per decision 2 |
| `src/views/mcp-env.ts` | `.mcp.json` hint text → "el toggle escribe `.claude/settings.json`" (CLAUDE_HINT reworded) |
| `README.md` | "Known limitation — MCP toggle vs Claude Code" → "MCP toggle semantics" |
| `tests/mcp-toggle.test.ts` | `.mcp.json` suite rewritten: settings file created / appended / element removed / key removed when empty / byte-exact roundtrip / no-op when already listed / legacy marker respected / invalid settings rejected / `.mcp.json` left byte-identical |
| `tests/scan.test.ts` | new case: an MCP listed in `disabledMcpjsonServers` scans as `enabled: false`; invalid `.claude/settings.json` scans with a warning and unchanged state |
| `tests/api-staged.test.ts` | one staged `.mcp.json` case: stage 1 diff targets `.claude/settings.json` without touching files; stage 2 applies and the snapshot flips |

## 5. Error handling

- Decision 6 errors are `400` with the existing `{ error, detail }` shape; no-op toggles return the standard `(sin cambios)` edit.
- Path safety: the settings path is a code constant (never user input) and still passes through `resolveInRoot`, which handles the missing-file case via the normalized prefix check (realpath comparison is best-effort).
- A `.claude/settings.json` that exists but is empty → treated as `{}` (insert key into the empty object).
- Applying the write needs the `.claude/` directory to exist; the toggle creates the file only under `.claude/` when absent — `atomicWrite` writes the temp file in the same directory, so the directory is created first when missing.

## 6. Testing

- `mcp-toggle.test.ts` (rewritten `.mcp.json` suite): create-file disable; append to an existing array preserving siblings and formatting; enable removes only the element; enable that empties the array removes the key (byte-exact roundtrip both with the key pre-existing and pre-absent); no-op when the name is already listed; legacy marker: disable no-ops, enable strips the marker from `.mcp.json`; invalid settings JSON / non-array key → `config_invalid`; `.mcp.json` bytes untouched by any settings-path edit; comments in `.claude/settings.json` survive.
- `scan.test.ts`: mini-harness copied to a tmp dir + `.claude/settings.json` listing `context7` → `enabled: false` for the `.mcp.json` entry while the `opencode.jsonc` entry stays enabled; invalid settings JSON → warning, state unaffected.
- `api-staged.test.ts`: staged `.mcp.json` toggle — stage 1 returns a diff on `.claude/settings.json` and touches nothing; stage 2 applies atomically and the returned snapshot reports the server disabled.
- Full gate `bun run repo:check` green; marker-path suites untouched (no `opencode.jsonc` behavior change).

## 7. Non-goals

Writing `enabledMcpjsonServers` (redundant — absence already means enabled, and rejection wins anyway); `.claude/settings.local.json` (reported precedence bugs; project settings is the supported shared file); deleting the `.mcp.json` entry instead of disabling (the definition must survive — that is why we mark/reject, never delete); multi-file atomic toggles; snapshot schema changes; user-scope Claude settings (`~/.claude/settings.json`); any change to `opencode.jsonc` marker semantics.

## 8. Open items

- Created settings files carry no `$schema` — minimal scaffold only (decided NO).
- `docs/acceptance.md` C6 remains the Phase-5 record; it is only updated if the checklist should track current behavior rather than history.
