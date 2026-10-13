# AGENTS.md — harness-manager

Panoramic agent-harness dashboard, **100% online**: hosted single-file UI (Cloudflare Workers) + E2E-encrypted relay (Cloudflare Worker + Durable Object) + headless local agent (`bun agent.ts`) running on the machine that holds the harness. Pattern: snapshot pipeline (Bun scripts) + Vite single-file bundle. There is no local UI and no local action server.

## Commands

| Command | Effect |
| --- | --- |
| `bun run pull` | scan harness root → `data/harness.json` (schema-validated, atomic) |
| `bun run agent [code]` | headless agent: joins the relay as the engine (no code → generates its own room and prints the pairing URL) |
| `bun run build:online` | vite build → `dist-online/` (single-file bundle, zero harness data embedded) |
| `bun run deploy:ui` | build + `wrangler deploy` the hosted UI Worker |
| `bun run dev` + `bun run relay:dev` | local dev loop: vite + dev relay, open with `?relay=ws://127.0.0.1:8788` |
| `bun run engine` | `server.ts` — API-only loopback diagnostic (no UI) |
| `bun test` / `bun run types:check` / `bun run lint` | quality gates |
| `bun run repo:check` | format + lint + types + relay types + tests |

## Rules

1. `data/harness.json` and `dist-online/` are generated artifacts — never hand-edit them.
2. A failed, empty, or invalid scan NEVER overwrites the last good snapshot — abort by name.
3. The scanner reads only the target harness directory. **Env values are never read or written** — only variable names and presence.
4. All writes from agent actions are confined to the harness root (path-traversal guard) and always go through diff → confirmation → atomic write → re-scan.
5. The UI never sends arbitrary command strings — only script names declared in the target harness `package.json`.
6. There is no local fetch path: the dashboard and picker live on the hosted site and talk to the agent through the relay only (spec 2026-10-12 — never reintroduce a local UI fallback or a vite `/api` proxy).
7. No credentials involved; no `.env` required for this repo.
8. No AI attribution in commits. Confirm before push (repo stays private until sanitization).
