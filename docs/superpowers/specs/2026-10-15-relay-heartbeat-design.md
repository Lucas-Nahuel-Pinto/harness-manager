# Relay Heartbeat (Keepalive) — Design

**Date:** 2026-10-15 · **Status:** implemented (2026-10-15 — engine `a35cf04`) · **Scope:** harness-manager repo only (UI transport, engine relay client, relay RoomLogic)
**Amends:** `2026-10-09-harness-manager-online-design.md` (§6 control frames — the relay protocol gains cleartext ping/pong) and `2026-10-09-online-mode-implementation-plan.md` §Risks ("no polling heartbeat in v1") — the v1 decision is reversed after field reports of ~60s idle disconnects.

## 1. Problem

Online mode has zero keepalive: after the last API response both WebSocket legs go silent (explicit v1 decision, plan 2026-10-09 line 74 — no ping/pong/heartbeat anywhere in `src/` or `relay/`). The network path then closes the idle connection ~60s in; both sides only notice when the socket errors/closes, then reconnect through the 1s→30s backoff. Reported fallout:

- **idle ~1 min** → the panel flips offline (root cause — every idle period repeats the cycle),
- **re-scan after the silent drop** → the first action fails; `refresh.ts` additionally labels every failure (including slow-scan timeouts) "Sin conexión con el servidor" (amplifier, not fixed here),
- reload probe fallback / daemon-mints-new-room (separately diagnosed, not selected for this change).

## 2. Goal

Both legs send a cleartext ping every 25s and the relay answers each ping with a pong — **bidirectional traffic ≤25s per leg**, well under the observed ~60s closer. Idle sessions stay connected indefinitely.

```
ui leg:      ping ──► relay ──► pong ──► ui      (every 25s, same on the engine leg)
             relay answers the SENDER only — pings are never forwarded cross-leg
```

## 3. Binding decisions

1. **Frame shape + cadence.** `{"v":1,"t":"ping"}` cleartext, every `HEARTBEAT_MS = 25_000` ms, sent by BOTH client legs (`WSTransport` and `startRelayClient`). Same cleartext control family as join/presence — never encrypted; the envelope contract (ciphertext frames are `{v,n,c}`, never carry `t`) is untouched.
2. **Relay answers the sender.** `RoomLogic.handleFrame` intercepts a ping BEFORE routing and returns `{"v":1,"t":"pong"}` targeted at the sender only. Pings are never forwarded cross-leg (the engine never receives UI pings and vice versa). A client-sent pong → dropped. Presence-shaped input keeps being dropped (unchanged).
3. **Heartbeats keep the room out of the 24h sweep.** `handleFrame` already stamps activity on entry — a panel left open pings its room alive (live sockets = live room, by design).
4. **Clients ignore control frames before decryption.** The UI leg already ignores any cleartext `t` frame (`isControlShaped`) → ping/pong ignored for free. The engine leg widens `isJoinShaped` to the SAME `isControlShaped`, now shared from `protocol.ts`: join/presence/ping/pong are all skipped pre-decrypt. No behavior change for envelopes.
5. **Timer lifecycle.** The interval starts on socket open (right after join), is cleared on `handleDown` and `close`, and only sends while the owning socket is still the current one and `OPEN` (reconnect re-arms it). `heartbeatMs` option (default `HEARTBEAT_MS`) exists purely as a test seam.
6. **No dead-peer detection here.** No pong-timeout teardown: the existing error/close → backoff machinery already handles dead sockets. Liveness-failure semantics would be a separate design.
7. **Explicitly out of scope** (diagnosed, not selected): wider reload probe in `resumeOnlineSession`, distinct timeout-vs-disconnection messaging in `refresh.ts`, persistent pairing code across daemon restarts.

## 4. Components

| File | Change |
| --- | --- |
| `src/online/protocol.ts` | NEW `HEARTBEAT_MS = 25_000`, `PING_FRAME`; NEW exported `isControlShaped` (moved from `transport.ts`); comment fixed — presence AND heartbeat control frames are the cleartext payloads |
| `src/online/transport.ts` | heartbeat interval per decision 5 (start on open / stop on down+close / socket-identity guard / `heartbeatMs` option); local `isControlShaped` removed in favor of the shared one |
| `src/online/relay-client.ts` | mirror heartbeat interval; `isJoinShaped` replaced by the shared `isControlShaped`; `heartbeatMs` option |
| `relay/src/room.ts` | NEW local `heartbeatKind` + `PONG_FRAME` (self-contained, no new imports — room.ts doctrine); ping → pong-to-sender before routing; pong → dropped; `handleFrame` doc comment updated |
| `tests/online-protocol.test.ts` | cadence/frame constants; `isControlShaped` true for join/presence/ping/pong, false for req/res payload shapes, non-objects, non-JSON |
| `tests/online-room.test.ts` | ping → single pong targeted at the sender (other members get nothing); pong → dropped; unknown-member ping → dropped |
| `tests/online-transport.test.ts` | recording fake relay: join + ≥2 exact pings observed; interval stops after `close()`; injected ping/pong leave the leg `online`; integration: both legs on `heartbeatMs: 50` through the real dev relay while two snapshot roundtrips stay green |
| `tests/online-relay-client.test.ts` | recording fake relay: join + ≥2 pings; stops after `close()`; injected control frames never log `frame descartada` and never fire `onDisconnect` |

No changes: `relay/worker.ts`, `relay/dev.ts` (both already route through `RoomLogic.handleFrame`), `src/main.ts`, `src/server/app.ts`.

## 5. Error handling + rollout compatibility

- **Skew-safe both ways.** New client + old relay → the old relay forwards pings as cross-leg junk, which receivers already drop (no pong, but per-leg outbound traffic continues; the pong adds reverse-direction insurance). Old client + new relay → unchanged behavior. Deploy order therefore does not break anything; recommended order is relay first, then panel.
- Ping shape is validated (`v === 1 && t === 'ping'`) before answering; a pre-join ping is already rejected by the relay's join-required guard (dev/worker, unchanged).
- Sends on a closing socket are swallowed by the existing guards (`readyState` check on clients, `safeSend` try/catch on the relay); a socket that dies mid-tick still flows through error/close → backoff reconnect.

## 6. Test matrix

See §4 tests row. Coverage: frame/constant shape (unit) · relay routing semantics (unit) · both legs actually send pings and stop on close (fake-relay integration) · control frames are ignored without disturbing status or logs (fake-relay integration) · full ping→pong loop with both real legs through the dev relay leaves API roundtrips green (integration).

## 7. Cost

2 legs × 1 frame/25s ≈ 6.9k frames/day per room vs the 100k Worker requests/day free tier — negligible (retires the 2026-10-09 free-tier concern for real).
