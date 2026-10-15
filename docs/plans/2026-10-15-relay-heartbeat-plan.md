# Relay Heartbeat — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-15-relay-heartbeat-design.md` · **Gate:** `bun run repo:check` green · **Single phase — everything ships together** (both client legs + relay logic are one behavior change; skew-safe either way per spec §5, but a partial ship would leave the loop half-open)

## Phase 1 — keepalive loop

1. `src/online/protocol.ts` — `HEARTBEAT_MS = 25_000` + `PING_FRAME` constants; export `isControlShaped` (moved verbatim from `transport.ts`, comment widened to join/presence/ping/pong); fix the "Presence frames are the only cleartext payload" comment (presence + heartbeat control frames).
2. `src/online/transport.ts` — heartbeat interval (start on `open` after join · stop on `handleDown` after the stale-socket guard and on `close` · guard `socket === ws && readyState === OPEN` inside the tick · `heartbeatMs` option in `WSTransportOptions`); drop the local `isControlShaped` in favor of the shared import.
3. `src/online/relay-client.ts` — mirror interval in the engine leg (`heartbeatMs` option in `RelayClientOptions`); replace `isJoinShaped` with the shared `isControlShaped` (join/presence/ping/pong all skipped pre-decrypt).
4. `relay/src/room.ts` — local `heartbeatKind(text): 'ping' | 'pong' | null` + `PONG_FRAME` const (no new imports — self-contained doctrine); `handleFrame`: member check first, then ping → `[{ toId: fromId, text: PONG_FRAME }]`, pong/presence/malformed → dropped, routing unchanged after that; doc comment updated.
5. Tests — spec §6 matrix: protocol (constants + `isControlShaped` classification) · room (pong-to-sender only, pong dropped, unknown-member ping dropped) · transport (recording fake relay: exact pings, stop after `close()`, injected control frames keep the leg `online`) · relay-client (same send/stop, no `frame descartada` log, no `onDisconnect`) · integration (real dev relay, both legs `heartbeatMs: 50`, two snapshot roundtrips green, status never flips).
6. Dead-reference scan — "only cleartext payload" wording and `isJoinShaped` references clean across `src/ relay/ tests/` (historical 2026-10-09 plan/spec stay untouched as records).
7. `verify:` `bun run repo:check` green (format + lint + types + relay types + full suite).

**Commits:** `docs: add relay heartbeat design + plan` · `feat: keep relay sockets alive with a cleartext heartbeat` · `docs: mark relay heartbeat implemented`

## Phase 2 — production (post-push, user-gated)

1. `bun run deploy:ui` — the panel bundle carries the UI leg.
2. Deploy the relay Worker from `relay/wrangler.toml` (`harness-manager-relay`, Durable Object) — recommended first (skew-safe either way).
3. Restart the local daemon (start script) so the engine leg picks up the heartbeat — the running agent keeps the old code until restart.
4. Smoke: open the hosted panel, leave it idle >1 min → status stays online; Re-scan works while idle.

## Risks

- **Timer leaks** — intervals cleared on `handleDown`/`close`, socket-identity guard inside every tick, every test closes its client in `finally`.
- **Test flakiness on small cadence** — 50–60ms ticks against 3–5s `waitFor` budgets (an order of magnitude of slack); no test ever waits for the real 25s.
- **Rollout skew** — forward/backward compatible per spec §5; neither order breaks the current loop.
- **Pong misclassified as an envelope** — impossible by construction: the control-shape check runs before any decrypt attempt on both legs; regression-tested with injected frames.
