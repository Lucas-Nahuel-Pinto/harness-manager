# Remove Offline Fallback — Design

**Date:** 2026-10-12 · **Status:** approved (2026-10-12 — design approved in chat; implementation pending) · **Scope:** harness-manager repo only
**Amends:** `2026-10-11-web-picker-agent-design.md` — that pivot deleted all offline UI but kept the local fetch path as a loopback/file fallback; this spec removes that fallback. `server.ts` (API-only diagnostic) survives untouched.

## 1. Problem

The 2026-10-11 pivot deleted every offline UI surface, yet a "historical fetch path" survived for loopback and `file://` origins: `detectMode` returns `'local'`, the API seam defaults to `FetchTransport` (vite `/api` proxy → engine at `127.0.0.1:7399`), and `src/server/cors.ts` exists for the browser local-UI → engine cross-port hop. The product is online-only in every documented flow, so this fallback is dead weight in production and a drift magnet: two boot paths, per-origin branching, tests covering a mode no user reaches, and docs carrying a "fallback" that invites resurrecting offline promises.

## 2. Goal

**One boot path for every origin** (hosted and loopback alike): no valid `#c=` fragment → launcher screen; valid `#c=` → agent probe → dashboard. Zero local fetch, zero vite proxy, zero CORS. `bun run engine` survives purely as an API diagnostic (curl / test harness), never as a UI backend.

```
 cualquier origen (hosted, localhost, file://)
   ├─ #c= válido ──► resumeOnlineSession (probe) ──► agente 'running' → dashboard
   │                                            └──► picker / sala muerta → launcher (mismo código)
   └─ sin #c= válido ──► launcher screen (genera código + comando)
```

## 3. Binding decisions

1. **`detectMode` collapses to online rules for every origin.** `UiMode = 'online' | 'online-unpaired'`; `isLocalOrigin` deleted; signature becomes `detectMode(hash, search)` (the `origin` argument stops being read); the `?mode=local|online` overrides are deleted (`?mode=online` becomes meaningless — everything is online; `?mode=local` has no target). `relayOverride` is untouched.
2. **The API seam demands a transport.** `src/serve.ts` loses the `FetchTransport` default and the already-dead `isOnlineMode` export. `enableOnlineMode(transport)` keeps its name (surgical — the seam's job is unchanged); after boot, `activeTransport` is set and `actionsEnabled()` is simply `transport.status === 'online'`. A boot that forgets the transport is a programming error that degrades gracefully: views render with actions disabled, nothing fetches.
3. **`FetchTransport` deleted** from `src/online/transport.ts`. The `Transport` interface and `WSTransport` remain — the WS transport is the only implementation.
4. **`src/main.ts` dispatch goes origin-agnostic.** `online-unpaired` → launcher; anything else → `resumeOnlineSession()`. `bootApp()` loses its `mode` parameter (no branch inside); the header badge is always `modo online · escritura`; `startOnlineTransport()` runs unconditionally at the end of `bootApp`, still before the first render (preserves the current ordering guarantee).
5. **Loopback and `file://` origins join the online rules.** `bun run dev` at `localhost:5173` without `#c=` shows the launcher; the local dev loop is `bun run relay:dev` + `?relay=ws://127.0.0.1:8788` + `bun agent.ts <CODE> --relay ws://127.0.0.1:8788` (user decision 2026-10-12: dev goes100% through the relay — same flow production runs). A `file://` origin renders the launcher and, without internet, nothing can pair — by design, the product requires internet (LAN mode stays a non-goal).
6. **CORS deleted.** `src/server/cors.ts` and the `withCors` / OPTIONS-preflight wrap in `src/server/app.ts` existed solely for a browser local UI calling the engine cross-port. The agent path is encrypted frames (not HTTP); curl and the test harness don't need CORS. The engine keeps serving the same routes header-free.
7. **`server.ts` survives unchanged** — API-only loopback diagnostic (acceptance L6/C4). Out of scope.
8. **vite proxy dies.** `vite.config.ts` drops `server.proxy` and its comment points at the relay dev loop.
9. **`package.json` description refreshed** — it still says "local server for visualizing" (v1 wording the pivot never updated).

## 4. Components

| File | Change |
| --- | --- |
| `src/online/mode.ts` | `'local'` out of `UiMode`; `isLocalOrigin` DELETED; `detectMode(hash, search)`; `?mode=` overrides DELETED; `relayOverride` untouched |
| `src/main.ts` | origin-agnostic dispatch; `bootApp()` without `mode` param; badge fixed `modo online · escritura`; `startOnlineTransport()` unconditional |
| `src/serve.ts` | seam requires transport: `FetchTransport` default + `isOnlineMode` DELETED; `actionsEnabled()` = transport status; `apiGet`/`apiPost` unchanged |
| `src/online/transport.ts` | `FetchTransport` DELETED |
| `src/server/cors.ts` | DELETED |
| `src/server/app.ts` | drop OPTIONS preflight + `withCors` wrap (route logic untouched) |
| `vite.config.ts` | drop `/api` proxy; comment → relay dev loop |
| `package.json` | `description` refreshed (scripts unchanged) |
| `tests/online-mode.test.ts` | rewritten: `detectMode` online rules (loopback/`file://` now follow them) + `relayOverride`; `isLocalOrigin` suite DELETED |
| `tests/online-transport.test.ts` | `FetchTransport` delegation suite DELETED; WSTransport suites untouched |
| `README.md` | dev loop → relay:dev flow; remove the `/api` proxy mention; "no local UI" claims stay true |
| `docs/online-vs-offline.md` | "the local fetch path survives only as a fallback for loopback/file origins" → there is no local path at all |

## 5. Error handling

- Boot with no transport set (defensive): `actionsEnabled()` returns false, views render disabled, nothing fetches, no crash.
- Loopback origin without `#c=` → launcher, same as hosted. Loopback with a dead `#c=` → probe exhausts → launcher with the same code (already the hosted behavior; now universal).
- `file://` origin: launcher renders; pairing requires internet — by design.
- Engine diagnostic: routes unchanged; only CORS headers disappear (no test asserts them).

## 6. Testing

- `online-mode.test.ts`: `detectMode` — valid `#c=` → `online`; absent/invalid → `online-unpaired`, explicitly covering loopback and `file://` origins following online rules; `relayOverride` suite kept.
- `online-transport.test.ts`: WSTransport suites (presence, fast-fail, roundtrip) untouched; FetchTransport suite deleted.
- `api-staged` / `online-relay-client` / `agent-controller` tests: untouched (route behavior unchanged minus CORS headers).
- Full gate `bun run repo:check` green after each phase; production smoke after the final deploy (launcher → agent → picker once).

## 7. Non-goals

LAN/no-internet mode (unchanged non-goal), deleting `server.ts` or `bun run pull`, relay/protocol changes, renaming `serve.ts` / `enableOnlineMode` (cosmetic churn — the seam keeps its name and docstring), any launcher/picker UX change.

## 8. Open items

- **CORS deletion ripple** — grep found no test importing `cors.ts` or asserting its headers; confirm at implementation before deleting.
- **`.bat` / `.sh` double-click flow** — unaffected (agent-generated code prints the pairing URL; opening it from the hosted origin is the online path). Verify no doc still promises a `file://` escape hatch.
- **Phase ordering** — Phase 1 (UI chain: mode/main/serve/transport + tests) ships alone with cors/proxy still present; Phase 2 (cors + vite + docs) cleans up. Each phase = one commit, gate green.
