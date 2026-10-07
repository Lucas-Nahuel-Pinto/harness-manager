# AGENTS.md — harness-manager

Panoramic agent-harness dashboard. Pattern: snapshot pipeline (Bun scripts) + single-file read-only app (Vite) + local action server.

## Commands

| Command | Effect |
| --- | --- |
| `bun run pull` | scan harness root → `data/harness.json` (schema-validated, atomic) |
| `bun run build` | embed snapshot → `dist/index.html` (read-only mode) |
| `bun run serve` | local server (127.0.0.1) with action API + UI |
| `bun test` / `bun run types:check` / `bun run lint` | quality gates |
| `bun run repo:check` | format + lint + types + tests |

## Rules

1. `data/harness.json` and `dist/index.html` are generated artifacts — never hand-edit them.
2. A failed, empty, or invalid scan NEVER overwrites the last good snapshot — abort by name.
3. The scanner reads only the target harness directory. **Env values are never read or written** — only variable names and presence.
4. All writes from `serve` actions are confined to the harness root (path-traversal guard) and always go through diff → confirmation → atomic write → re-scan.
5. The UI never sends arbitrary command strings — only script names declared in the target harness `package.json`.
6. `dist/index.html` is read-only mode: action buttons disabled with a hint to use `serve`.
7. No credentials involved; no `.env` required for this repo.
8. No AI attribution in commits. Confirm before push (repo stays private until sanitization).
