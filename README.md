# harness-manager

Panoramic agent-harness dashboard: a snapshot pipeline plus a self-contained single-file app for visualizing and managing the elements of any agent harness (skills, commands, agents, MCPs, env, scripts, registries) — the same pattern as [`jira-traceability-manager`](https://github.com/Lucas-Nahuel-Pinto/jira-traceability-manager), pointed at a harness directory instead of Jira.

## Status

Phase 1 (scaffold) done. Scan pipeline, tabs and action server land in later phases.

## Commands

| Command | Effect |
| --- | --- |
| `bun run pull` | scan harness root → `data/harness.json` (schema-validated, atomic) |
| `bun run build` | embed snapshot → `dist/index.html` (read-only, double-click) |
| `bun run serve` | local server with actions (toggle MCP, run scripts, assign models) |
| `bun test` / `bun run types:check` / `bun run lint` | quality gates |

## Docs

- Design: `docs/superpowers/specs/2026-10-07-harness-manager-design.md`
- Plan: `docs/plans/2026-10-07-implementation-plan.md`

## License

MIT
