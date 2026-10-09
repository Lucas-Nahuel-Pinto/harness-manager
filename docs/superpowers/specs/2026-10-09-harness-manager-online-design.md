# Harness Manager Online (B2) — Design

**Date:** 2026-10-09 · **Status:** approved design (pre-implementation) · **Scope:** harness-manager repo only

## 1. Problem

harness-manager today is 100% local: the engine (`server.ts` / launcher) reads and writes files on the operator's machine, and the UI is either an embedded build opened via `file://` or served from `127.0.0.1`. There is no way to open the dashboard from another device (phone, another laptop) without being physically on that machine.

## 2. Goal

Let the user open the full harness-manager UI from any device on any network, while **all harness files and credentials stay on the operator's machine**. The browser is a remote control, not a file store: nothing is uploaded, no repo is copied to the cloud, and `.env` values never leave the machine (the scanner never reads them by design — presence of key names only).

Chosen variant (user decision): **B2 — fixed web UI + local engine over a relay**, hosted **entirely on Cloudflare** (Pages + Workers + Durable Objects, free tier), transport approach **1 — dumb relay + end-to-end encryption in the clients**.

## 3. Security model (binding)

| Threat | Mitigation |
| --- | --- |
| Relay compromise / curious operator | All payload frames are AES-GCM ciphertext; the relay only forwards opaque bytes. Presence metadata (roles/counts) is the only cleartext. |
| Credentials (`.env`) leaking online | `.env` values are never read into the snapshot (scanner reads key names only — invariant that already exists). No credentials exist anywhere in the online flow. |
| Session code leakage | Code = 16 random bytes → base32 (26 chars). Lives in the URL **fragment** (`#c=…`), which browsers never send to servers — Cloudflare never sees it. Room id = SHA-256(code), key = PBKDF2(code); without the code there is no room and no key. |
| Brute force of rooms | 128-bit entropy; infeasible. Frames are AES-GCM authenticated — garbage from a wrong key fails decrypt and is dropped. |
| Engine exposure to the network | Engine binds `127.0.0.1` always and only makes **outbound** connections to the relay. No inbound ports, no firewall changes. |
| Repo "uploaded to cloud" | Never happens. The engine reads local files; only the sanitized snapshot travels, E2E-encrypted. |
| Residual (accepted) | Harness structure (skill names, paths, env key names) is visible in the browser that holds the code. `script-run` output is displayed in the browser — only user-confirmed runs (existing staged-confirm). Code persisted in `localStorage` is readable by scripts on the same origin (the origin serves only our bundle; CSP: no third parties). |

Session code is regenerated on every engine start → new room; stale rooms expire after 24h idle (DO alarm).

## 4. Architecture

```
                    Cloudflare (single account)
        ┌──────────────────────────────────────────────┐
        │  Pages: static UI (dist-online/)            │
        │  Worker: GET /health · WS /relay            │
        │    └─ Durable Object "Room" (one per room)  │
        │       · members: engine | ui                │
        │       · forwards OPAQUE frames both ways    │
        │       · presence broadcasts {role, counts}  │
        │       · 24h idle expiry                     │
        └──────────────▲───────────────▲───────────────┘
                       │ outbound WS  │ outbound WS
        ┌──────────────┴───────┐       │
        │ Local engine         │       │  Browser (any device)
        │  · 127.0.0.1 always  │       │  · same bundle, WS transport
        │  · reads/writes YOUR │       │  · pairing screen if no #c=
        │    files             │       │
        │  · new: relay client │
        └──────────────────────┘
```

### Units

| Unit | Path | Depends on | Purpose |
| --- | --- | --- | --- |
| Relay worker | `relay/` (wrangler project) | CF Workers runtime only | Thin router: rooms, presence, forward. Zero product logic, zero persistence of payload. |
| Crypto module | `src/online/crypto.ts` | WebCrypto (both runtimes) | Code → room id + AES-GCM key; encrypt/decrypt frame helpers. Shared by engine and UI (identical build). |
| Pairing | `src/online/pairing.ts` | crypto | Generate code, build/print pairing URL. |
| Engine relay client | `src/online/relay-client.ts` | crypto, `src/server/app.ts` | Outbound WS, reconnect backoff, dispatch `req` into existing `createApp()`, reply `res`. |
| UI transport | `src/online/transport.ts` | crypto | `api(method, path, body)` interface: `FetchTransport` (today's behavior) and `WSTransport` (promise-per-id). |
| Local dev relay | `relay/dev.ts` | same routing module as the DO | Runs the room logic locally over plain WS for tests/dev without deploying. |

## 5. Pairing flow

1. `bun run online --root <harness> [--port N] [--relay wss://…]` (default relay = production URL baked at build).
2. Engine: code = 16 bytes CSPRNG → base32 (no padding, 26 chars); `room = hex(SHA-256(code))`; `key = PBKDF2-SHA256(code, salt="harness-manager-online-v1", 100_000 iters, 256-bit)`.
3. Engine dials `wss://<worker>/relay`, sends join for `room` with role `engine`.
4. Engine prints (next to the local URL):
   `Online: https://<pages-host>/#c=<CODE>`
5. Browser opens the URL: reads `#c=` from the fragment (never transmitted), derives room + key identically, joins with role `ui`.
6. Local mode is unchanged: opened via `file://` or localhost without `#c=` → HTTP fetch to the local engine as today.

## 6. Protocol

Cleartext WS text frames are always the envelope:

```jsonc
{ "v": 1, "n": "<base64 nonce>", "c": "<base64 AES-GCM ciphertext>" }
```

Cleartext payload (before encryption) is JSON with one of:

| Type | Direction | Shape | Notes |
| --- | --- | --- | --- |
| `req` | ui → engine | `{id, method, path, body?}` | Maps 1:1 onto existing routes (`/api/snapshot`, `/api/action`, `/api/run`). Engine calls `createApp(root)` with `new Request(…)`. No new API surface. |
| `res` | engine → room | `{id, status, body}` | Broadcast; each UI resolves the promise it owns and ignores other ids. |
| `presence` | relay (unencrypted) | `{v, t:"presence", members:[{role}]}` | Metadata only. Envelope-level `t` field distinguishes it from crypto frames. |

- AEAD: AES-GCM-256, 12-byte random nonce per frame, AAD = room id.
- Timeouts: UI 30s; `script-run` requests 45s.
- Reconnect: exponential backoff 1s → 30s + jitter, both sides. On UI disconnect, all pending requests reject with "conexión perdida" toast.
- Multiple browser tabs: supported — every UI in the room receives broadcasts; ids disambiguate.

## 7. Code changes (harness-manager)

### Engine

- `server.ts` / `launcher.ts`: add `--online [wss://…]` flag. Launcher spawns the engine with the flag; engine prints the pairing URL next to the local URL; engine exit closes the relay connection (existing exit hook extended).
- `src/server/app.ts`: **no route changes** — it is invoked by the relay client via `new Request()`.
- `package.json`: `"online": "bun run build:online && bun launcher.ts --online"`. Note: the pairing URL always points at the **deployed** Pages site (constant `PAGES_URL`); `build:online` runs first so a local `dist-online/` also exists for testing the online UI before/without a deploy.

### UI

- `src/data.ts`: build-time `HM_ONLINE` define — online build embeds **no snapshot** (empty state: "esperando motor"). Local build keeps embedding `data/harness.json`.
- `src/serve.ts` / `src/main.ts`: mode detection — fragment `#c=` present + non-local origin → `WSTransport`; otherwise current fetch path. New top-bar badge: engine ● online / ● connecting / ● offline (from WS status + presence). If neither engine nor code → pairing screen (paste a pairing URL / code).
- Actions: unchanged staged-confirm flow (the transport swap is below the action layer).

### Builds

| Command | Output | Content |
| --- | --- | --- |
| `bun run build` | `dist/` | local build, snapshot embedded (unchanged) |
| `bun run build:online` | `dist-online/` | `HM_ONLINE=1`, no embedded snapshot, default relay URL defined at build |

### Deploy (single CLI: `wrangler`)

- `wrangler login` (user performs authentication; agent never handles credentials).
- `wrangler deploy` → Worker + DO binding (`relay/`), route `wss://<worker>.workers.dev/relay`.
- `wrangler pages deploy dist-online` → `<project>.pages.dev`.
- Worker requires **no secrets** (no accounts, no tokens).
- CI/automation: out of scope v1 (manual deploy commands documented in README).

## 8. Testing

1. **Unit** (part of `repo:check`): crypto derive/encrypt/decrypt roundtrip (engine-side and UI-side derivation produce identical keys from the same code), envelope encode/decode, pairing URL parse, backoff schedule, transport promise/id lifecycle.
2. **Relay routing**: DO logic extracted into a pure module; `relay/dev.ts` runs it on a local Bun WS server → tests for join/presence/forward/leave/expiry without deploying.
3. **Integration** (local): engine with `--online wss://localhost:<dev-relay>` + online UI served from `dist-online/` → snapshot fetch, staged-confirm mutation against a temp-dir fixture, disconnect/reconnect behavior.
4. **Post-deploy smoke**: pairing from a second network (phone) against production; verify presence, snapshot, one staged action, engine stop → banner offline.
5. Gates: `bun run repo:check` green at every phase boundary.

## 9. Non-goals (v1)

- Multiple engines / multi-room dashboard, accounts, passwords, QR pairing.
- Offline snapshot cache in the relay (would store user data in the cloud; rejected).
- WebRTC/P2P transport (rejected: no TURN, complexity).
- Vercel (its serverless cannot hold persistent WebSockets — the reason the whole stack is Cloudflare).
- Publishing `data/` snapshots or any harness content to Pages.
- Automation of `wrangler login`/`vercel login` (user authenticates interactively).

## 10. Implementation phases (summary — detail lives in the implementation plan)

1. **P1 — Protocol + crypto + dev relay**: `crypto.ts`, envelope, pairing, pure room module, `relay/dev.ts`, unit + routing tests.
2. **P2 — Engine online**: relay client, `--online` flag, dispatch into `createApp`, pairing URL output, exit cleanup, tests.
3. **P3 — UI online**: transport abstraction, mode detection, pairing screen, connection badge, empty online snapshot state, integration smoke.
4. **P4 — Deploy + acceptance**: wrangler project (Worker + Pages), prod smoke from two networks, README section, final `repo:check`.

## 11. Open items for implementation

- Exact base32 alphabet/variant (RFC 4648, no padding) recorded in code + tests.
- Relay URL strategy: **decided — committed constant** (`PAGES_URL` in `src/online/pairing.ts`), because the endpoint is public by nature and needs no secrecy; changing it means a normal commit + redeploy.
- Pages project connect via git (GitHub app) vs direct `wrangler pages deploy`: **decided for v1 — direct CLI deploy**.
