# Harness Manager Online (B2) — Implementation Plan

**Date:** 2026-10-09 · **Spec:** `docs/superpowers/specs/2026-10-09-harness-manager-online-design.md` (binding)
**Flow:** Phase → Code → Verify per phase · `bun run repo:check` must be green at every phase boundary.

---

## Phase 1 — Protocol + crypto + dev relay

**Tasks**

1. `src/online/crypto.ts` — WebCrypto-only (runs in Bun AND browser): `deriveKey(code)` → `{ room: hex SHA-256, key: CryptoKey }` (PBKDF2-SHA256, salt `"harness-manager-online-v1"`, 100_000 iters, AES-GCM-256); `encryptFrame(key, room, payloadJson)` → envelope `{v:1, n, c}` (12-byte random nonce, AAD = room); `decryptFrame` (wrong key → throw).
2. `src/online/pairing.ts` — RFC 4648 base32 (no padding) encode/decode; `generateCode()` = 16 bytes `crypto.getRandomValues` → 26-char code; `pairingUrl(pagesUrl, code)`; `parseCodeFromHash(location.hash)`. `PAGES_URL` committed constant (spec §11).
3. `src/online/protocol.ts` — frame envelope codec + payload types: `req {id, method, path, body?}` / `res {id, status, body}` / cleartext `presence {v, t:"presence", members}`; validation rejects malformed/unknown frames.
4. `relay/src/room.ts` — PURE room logic shared by DO and dev server: member registry (role `engine`|`ui`), forward engine→all UIs / ui→engine, presence broadcasts on join/leave, drop unparseable frames, idle-expiry state machine (24h). No Cloudflare imports here (testable under Bun).
5. `relay/dev.ts` — Bun WS server (`Bun.serve` WS handler) using `room.ts` locally: same join/forward protocol on `ws://127.0.0.1:8788` for tests and pre-deploy dev.
6. Tests: crypto roundtrip (derive twice from same code → identical room+key), wrong-code decrypt fails, base32 known vectors + roundtrip, pairing URL generate/parse roundtrip, envelope encode/decode, room forward/presence/expiry (fake sockets).

**Verify:** `bun run repo:check` green (new tests included); dev-relay integration test: fake engine + fake UI join a room, `req`/`res` crosses, presence fires on join.

---

## Phase 2 — Engine online

**Tasks**

1. `src/online/relay-client.ts` — outbound `WebSocket` (Bun) to relay URL, sends join with room+role `engine`; on decrypted `req` → `createApp(root)(new Request('http://engine.local' + path, …))` → reply `res` (no new HTTP listener; existing `127.0.0.1` server keeps running unchanged for local UI/curl); reconnect backoff 1s→30s + jitter; `close()` cleanly.
2. `src/online/pairing.ts` wiring in `server.ts`/`launcher.ts` — flag `--online [wss://…]` (default: relay prod URL constant `RELAY_URL`); engine prints `Online: <PAGES_URL>/#c=<CODE>` next to the local URL AFTER relay connect succeeds; failure to connect → warning, engine keeps serving local (never crash on relay outage).
3. `launcher.ts` — forwards `--online` to `spawnEngineProcess`; exit hook already kills engine → engine's own exit closes relay socket.
4. `package.json` — `"online": "bun run build:online && bun launcher.ts --online"` (build first so a local `dist-online/` exists for testing; pairing URL always points at deployed Pages — spec §7).
5. Tests: relay-client against `relay/dev.ts` (real sockets): snapshot `req/res` roundtrip; dispatch constructs correct Request (method/path/body); reconnect after dev-relay restart; pairing output matches `pairingUrl()` format.

**Verify:** `bun run repo:check` green; manual: `bun run online --root tests/fixtures/mini-harness --relay ws://127.0.0.1:8788` + scripted client through dev relay returns the mini-harness snapshot (44-skill boilerplate not required in test).

---

## Phase 3 — UI online

**Tasks**

1. `src/online/transport.ts` — `Transport` interface `api(method, path, body?, opts?) → Promise<…>`; `FetchTransport` wraps today's fetch path; `WSTransport` = connect with code → id→promise map, timeouts 30s (45s for `/api/run`), decrypt/encrypt, reconnect with pending rejection ("conexión perdida"), status callback for the badge.
2. Mode detection in `src/serve.ts` + `src/main.ts` — non-local origin + `#c=` → `WSTransport`; non-local origin without code → **pairing screen** (paste pairing URL or code, validates + stores in `localStorage`, sets `#c=`); local → `FetchTransport` (unchanged). All existing call sites switch to `transport.api(...)` (single seam — actions/staged-confirm untouched).
3. Top-bar connection badge — ● online (green) / ● connecting (ámbar) / ● offline (rojo) driven by transport status + presence; offline keeps last in-memory snapshot read-only with banner.
4. `vite.config` + `src/data.ts` — build modes: `bun run build` (local, embeds `data/harness.json`, outDir `dist/`) vs `bun run build:online` (`--mode online` → `HM_ONLINE=1` define → `data.ts` exports EMPTY snapshot, PAGES_URL/RELAY_URL defines, outDir `dist-online/`); online bundle must contain zero real harness data (grep check on output).
5. Tests: transport promise/id lifecycle (fake socket), mode-detection pure functions, timeout classification (run=45s), pairing-screen parse errors; integration: `dist-online` preview + dev relay + temp-root engine → snapshot renders, staged action on temp fixture passes, engine kill → offline banner.

**Verify:** `bun run repo:check` green; `bun run build:online` green (report size, assert no `data/harness.json` content: search bundle for a boilerplate-unique string like `shift-left-testing` = must be absent); integration smoke output in report.

---

## Phase 4 — Deploy + acceptance

**Tasks**

1. `relay/wrangler.toml` — Worker name, `main` entry wrapping `room.ts` logic, Durable Object binding (`class: Room`), compatibility date, no secrets (spec §7).
2. User-authenticated login — instruct user to run `wrangler login` interactively (agent NEVER handles credentials); verify with `wrangler whoami`.
3. Deploy: `wrangler deploy` (relay → `workers.dev`) then `wrangler pages project create` + `wrangler pages deploy dist-online` (project name committed as constant in scripts/README). Bake real `PAGES_URL`/`RELAY_URL` constants in `src/online/pairing.ts` before the final build.
4. Prod smoke (user joins from a second network — phone): pairing URL works, presence shows engine, snapshot loads, ONE staged action (mcp-toggle on temp root or Re-scan), engine stop → offline banner, engine restart → new code/URL (old room dead).
5. README section: "Online mode" — commands, pairing flow, security model (what travels / what never does, `.env` never leaves, E2E relay), deploy/update commands. `docs/acceptance.md` addendum: L8–L12 online checklist for user sign-off.
6. Sanitization: grep `dist-online/` for absolute paths, `QWolf`, `Agentic-Quality-Engineer`, `bunkai`, `BK-` → must be 0 hits; `git status` clean of `dist*/`.

**Verify:** `bun run repo:check` green; prod smoke checklist all ✅ with user sign-off; sanitizer grep 0 hits.

---

## Risks / open points

- **DO WebSocket Hibernation API** has Cloudflare-specific surface (accept/attach) — keep `room.ts` pure and confine hibernation glue to the DO class file; `relay/dev.ts` proves logic before deploy.
- **Windows → workers.dev (443) outbound** from Bun WebSocket: should work (TLS); fallback plan if blocked by corporate proxy: none for v1 (documented limitation).
- **Two-build Vite collision** (`HM_ONLINE` define): isolate via `vite build --mode online` + `env.harnessOnline`; never double-write `dist/`.
- **DO eviction/cold start** after idle → clients reconnect via backoff (Phase 1/2 backoff must be jittered to avoid reconnect storms).
- **Page reload mid staged-confirm**: stage-1 diff is stateless server-enforced (spec) — reload simply restarts the action; safe by design.
- **Wrangler auth is interactive** — Phase 4 must be scheduled with the user present; deploy step blocked until `wrangler login` done.
- **Free-tier limits** (100k Worker req/day, DO included): ample for personal use; presence heartbeats kept to one frame per membership change (no polling heartbeat in v1).
