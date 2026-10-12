# Remove Offline Fallback — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-12-remove-offline-fallback-design.md` (commit `8efc823`) · **Gate:** `bun run repo:check` green after every phase · **Repo stays shippable between phases**

## Phase 1 — UI chain: one boot path

1. `src/online/mode.ts` — `UiMode = 'online' | 'online-unpaired'`; DELETE `isLocalOrigin`; `detectMode(hash, search)` (drop the `origin` parameter and both `?mode=` overrides); `relayOverride` untouched; docstrings updated (no "historical fetch path" language).
2. `src/online/transport.ts` — DELETE the `FetchTransport` class; keep the `Transport` interface + `WSTransport`; seam docstring updated (`WSTransport` is the only implementation).
3. `src/serve.ts` — DELETE the `FetchTransport` default and the dead `isOnlineMode` export; `activeTransport: Transport | null`; `actionsEnabled()` = `activeTransport?.status === 'online' ?? false` (forgetting the transport degrades to disabled actions, no fetch, no crash); `enableOnlineMode` name and `apiGet`/`apiPost` kept.
4. `src/main.ts` — dispatch goes origin-agnostic: `online-unpaired` → `renderLauncherScreen`, else → `resumeOnlineSession()`; `bootApp()` loses the `mode` parameter (badge hardcoded `modo online · escritura`); `startOnlineTransport()` + `subscribe(renderFreshness)` run unconditionally, still before the first `render()`.
5. `README.md` (same phase — the proxy story goes stale the moment the fetch path dies): dev bullet + `bun run dev` row repointed to the relay loop (`bun run relay:dev` + `bun run dev` + open `http://localhost:5173/?relay=ws://127.0.0.1:8788` → launcher → `bun agent.ts <CODE> --relay ws://127.0.0.1:8788`); drop the "vite proxies /api to the engine" wording.
6. Tests — `tests/online-mode.test.ts` rewritten: `detectMode` valid `#c=` → `online` / absent-invalid → `online-unpaired`, explicitly asserting **loopback and `file://` origins now follow the online rules**; `?mode=` cases deleted; `relayOverride` suite kept. `tests/online-transport.test.ts`: DELETE the `FetchTransport` delegation suite; WSTransport suites untouched.
7. `verify:` `bun run repo:check` green · manual loopback smoke: `bun run relay:dev` + `bun run dev` → launcher at `localhost:5173` → `bun agent.ts <CODE> --relay ws://127.0.0.1:8788` → picker → bind → dashboard.

**Commit:** `refactor!: single online boot path — local fetch fallback removed`

## Phase 2 — Server cleanup, docs, deploy

1. DELETE `src/server/cors.ts`; `src/server/app.ts` drops the OPTIONS preflight + `withCors` wrap (import dies with it). Pre-check: no test imports `cors.ts` or asserts its headers (grep found none — re-verify before deleting).
2. `vite.config.ts` — drop `server.proxy`; comment repointed at the relay dev loop.
3. `package.json` — `description` refreshed (still says "local server for visualizing", v1 wording).
4. `docs/online-vs-offline.md` — "the local fetch path survives only as a fallback for loopback/file origins" → there is no local path at all; spec `Status` → implemented with commits.
5. Dead-reference scan — `FetchTransport`, `isLocalOrigin`, `mode=local`, `mode=online`, `withCors`, `corsPreflight`, `/api` proxy, "historical fetch" across `src/ tests/ docs/ README.md` must come back clean.
6. `verify:` `bun run repo:check` green · `bun run deploy:ui` → production smoke (launcher marker in curl + one playwright pass: open site → command → `bun agent.ts <CODE>` → picker binds → dashboard).

**Commit:** `refactor!: delete CORS and the vite /api proxy; online-only docs`

## Risks

- **Boot-order regression** — `enableOnlineMode` must keep running before the first render (every view gates on `actionsEnabled`); the guard removal in `main.ts` keeps today's position; loopback smoke in Phase 1 proves it end-to-end.
- **Loopback dev confusion** — after Phase 1, `bun run dev` alone shows a launcher that can never pair (no agent); that is why the README repoint ships in the SAME phase, not later.
- **`?mode=` removal ripples** — any doc or test still referencing the override dies in the dead-reference scan.
- **Production boot regression** — hosted origins already follow these exact rules, so the deployed behavior is unchanged in theory; the Phase 2 smoke (launcher + picker + dashboard on the real Worker) is the net.
