# Desktop App (Electrobun) — Online-Only · Implementation Plan

**Date:** 2026-10-10 · **Spec:** `docs/superpowers/specs/2026-10-10-desktop-app-online-only-design.md` (binding)
**Flow:** Phase → Code → Verify per phase · `bun run repo:check` green at every boundary.

---

## Phase 1 — Electrobun scaffold + controller (pure lifecycle, tests migrate)

**Tasks**

1. Dependency + scaffold:
   - Pin `electrobun` in `devDependencies` (exact version — young framework, no `^`); `electrobun.config.ts` with app metadata (`harness-manager`), `build.bun.entrypoint: "src/desktop/main.ts"`, view entrypoint `src/desktop/view/index.html` (view can be a stub this phase).
   - `package.json` scripts: add `"desktop": "electrobun run"`; KEEP `serve`/`build` untouched until Phase 3 (repo stays shippable between phases).
2. Move `src/launcher/browse.ts` + `src/launcher/recents.ts` → `src/desktop/` (imports updated, no logic changes; their tests move path-wise only).
3. `src/desktop/controller.ts` — pure lifecycle, every external seam injectable:
   - `createController(opts: { root: string | null, spawnEngine: (root) => EngineHandle, openUrl: (url) => void, recentsFile: string, hmNoOpen?: boolean })` — `EngineHandle` mirrors today's launcher handle (stdout lines, exit promise, kill with 5s escalation — port `killEngine` from `src/launcher/app.ts`).
   - State machine: `picker → starting → running | error`; `pickRoot(path)`: validate (absolute/exists/isDirectory, 400-equivalent `{ ok:false, detail }`) → spawn with args `['bun', 'server.ts', '--root', path, '--online']` (ALWAYS online) → await first `Online: <url>` line (existing filter, migrated) → `addRecent` → `{ ok:true, pairingUrl }`; spawn failure → `error`, recents NOT written.
   - `openPairing(pairingUrl)` honors `HM_NO_OPEN` (skip openUrl; controller still returns the URL for the view to show as text).
   - `detener()` = graceful kill + escalation (migrated verbatim from launcher); exit listener → `crashed` state when not intentional.
4. Tests (new `tests/desktop-controller.test.ts`; retire `tests/launcher.test.ts` piecemeal):
   - pick happy path: spawn args, pairing URL captured from fake stdout, recents updated (temp file), `openUrl` called with `PAGES_URL/#c=`;
   - invalid roots (relative/missing/file) → error, spawn NOT called, recents untouched;
   - spawn throws / engine exits before `Online:` → error state, no recents write;
   - `HM_NO_OPEN` → no `openUrl`, URL still returned;
   - kill: graceful success + escalation timeout path (fake timers/seams as in current launcher tests);
   - crash after running → `crashed`; `Online:` filter cases (migrated).
   - browse/recents tests keep running from new paths.

**Verify:** `bun run repo:check` green; `bunx electrobun run` at least opens the stub window once on the dev machine (manual smoke, no assertion).

---

## Phase 2 — Window + view (picker ⇄ running)

**Tasks**

1. `src/desktop/main.ts` (thin glue): create `BrowserWindow` (fixed small size ~420×520, dark bg matching tokens), instantiate controller, RPC handlers: `getInitial` (recents + state), `pickRoot(path)`, `browse()` (main-side `pickFolder()`, returns path or `{cancelled}` / `{ error: browse_unsupported|browse_failed }`), `openApp()` (re-open pairingUrl), `quit()`; wire window **close** → `detener()` + process exit; `process.on('SIGINT'/'SIGTERM')` same.
2. `src/desktop/view/` — `index.html` + `index.ts` (RPC client only, no logic beyond rendering):
   - **Picker state**: recents rows (click → pickRoot), **Examinar…** (browse RPC; cancelled no-op; unsupported → toast + manual input), manual path input + confirm; error toasts.
   - **Starting state**: spinner-ish "iniciando motor…".
   - **Running state**: root path, status dot (`running` green / `crashed` red + "motor caído — reabrí la app"), **Abrir app** button, pairing URL shown as text (fallback when `HM_NO_OPEN` or browser blocked).
   - Dark tokens ported from `src/launcher/picker.ts`/`styles.ts`; values via `textContent`/escape (no innerHTML interpolation).
3. Verify against the PINNED electrobun docs (Context7/README of the installed version): close-hook semantics, RPC shape. If close-hook is unreliable → fallback per spec §8: `process.on('exit')` kill + `before-quit` if exposed.
4. Manual smoke on Windows: `.bat` → window → pick `tests/fixtures/mini-harness`… no — engine scan of a fixture would pair a useless session; pick the real bunkai root → hosted app opens paired, dot green, close window → engine gone (check `bun` child dead, hosted shows offline banner).

**Verify:** manual L20 pass on Windows; `repo:check` still green (glue untested by unit suite is expected).

---

## Phase 3 — Offline + launcher removal

**Tasks**

1. Delete: `launcher.ts`, `src/launcher/app.ts`, `src/launcher/picker.ts` (browse/recents already moved); `scripts/` embed path consumers; `src/snapshot.ts`; file://-only components.
2. `server.ts`: drop `dist/index.html` serving (API routes + relay transport unchanged).
3. `src/serve.ts` + `src/server-control.ts` + `src/main.ts`:
   - remove `isLauncherMode`/`isServeMode` branches, `fileModeStartFlow`, launcher poll loop, local start/stop buttons;
   - keep `isOnlineMode` + online transport + pairing screen + `dev` local mode — but local/dev boot no longer has an embedded snapshot: boot with an EMPTY model and pull `GET /api/snapshot` from the engine base (engine must be running; dev usage documented: run `bun run engine --root …` beside `bun run dev`).
   - `src/main.ts` boot matrix after removal: `online` (hosted) · `local` (dev, engine required) · `online-unpaired` (hosted, bad/missing `#c=`).
4. `package.json`: retire `serve`, `build`, `build:online` stays (hosted deploy), add nothing else; `.bat`/`.sh` → `bun run desktop`.
5. Tests: delete file://, launcher-serving, engine-UI, snapshot-embed tests; adapt `serve`-flag tests to the reduced matrix; `repo:check` green.
6. `data/harness.json` stops being consumed anywhere in-app — keep file + `pull` CLI (diagnostic), add `.gitignore` note? (file is tracked history — leave tracked, document as pull-cache in README).

**Verify:** `repo:check` green; grep shows zero references to `7397`, `fileModeStartFlow`, `__HM_LAUNCHER__`, `dist/index.html` outside docs/history.

---

## Phase 4 — Docs, acceptance, closeout, commits

**Tasks**

1. `README.md`: replace "Server control" + "Desktop entry" with "Desktop app (online-only)": flow diagram, `bun run desktop`, platform prereqs (WebView2 / webkit2gtk), `HM_NO_OPEN`, pairing recovery (console URL), dev workflow (vite + engine direct). Commands table updated.
2. `docs/acceptance.md`: rewrite L1–L15 where they reference the local dashboard (hosted equivalents), L16–L19 → desktop flow, add L20 (close kills engine + hosted offline banner), L21 (crash → red dot + reopen recovery), L22 (`HM_NO_OPEN` console fallback).
3. Commits (one responsibility each):
   - `feat: desktop controller with injectable engine lifecycle` (Phase 1)
   - `feat: Electrobun desktop window for root picker` (Phase 2)
   - `refactor!: remove loopback launcher and offline UI` (Phase 3 — breaking for `serve`/`build` scripts)
   - `docs: desktop-app README and acceptance L1-L22` (Phase 4)
4. Final `repo:check`; session memory save.

**Verify:** gate exit 0, tree clean, user manual L16–L22.

---

## Risks / open points

- **Electrobun API churn** — pinned version + docs verified in Phase 2 before glue; close-kill fallback documented in spec §8.
- **`Online:` capture timing** — relay join is async and re-fires on reconnect; controller consumes only the FIRST `Online:` line for the open; later lines are ignored for state (dot = process liveness).
- **Console window on `.bat`** — `electrobun run` from source keeps a console; hidden-console `wscript` recipe already documented; packaged `.exe` stays a non-goal.
- **Dev workflow regression** — removing the embed changes `bun run dev` to require a running engine; called out in README; affects only developers, not the operator flow.
- **Windows kill-on-close** — child `bun server.ts` may outlive the window if the close hook races; mitigation: kill in BOTH close-hook and `process.on('exit')`, and the Phase 2 manual smoke explicitly verifies the child is gone.
