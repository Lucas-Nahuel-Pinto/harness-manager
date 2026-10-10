# Harness Manager Launcher Root Picker — Implementation Plan

**Date:** 2026-10-09 · **Spec:** `docs/superpowers/specs/2026-10-09-launcher-root-picker-design.md` (binding; includes the cwd-default erratum)
**Flow:** Phase → Code → Verify per phase · `bun run repo:check` must be green at every phase boundary.

---

## Phase 1 — Browse + recents modules (pure, injectable) + unit tests

**Tasks**

1. `src/launcher/browse.ts`:
   - `browseCommand(platform: NodeJS.Platform): { cmd: string[], kind: 'stdout' | 'unsupported' }` — PURE builder:
     - `win32`: `powershell -NoProfile -Command "<Add-Type System.Windows.Forms; FolderBrowserDialog; SelectedPath on OK>"` (UTF-8 console output forced inside the command so accented paths survive);
     - `darwin`: `osascript -e 'POSIX path of (choose folder with prompt "Select harness root")'`;
     - `linux`: `zenity --file-selection --directory --title="Select harness root"`, fallback `kdialog --getexistingdirectory "Select harness root"` (both tried in order at runtime);
     - anything else → `kind: 'unsupported'`.
   - `pickFolder(opts?: { platform?, spawn? }): Promise<string | null>` — cancelled (empty stdout / nonzero exit / user-cancel codes) → `null`; unsupported or spawn failure → throw with a stable `code` (`browse_unsupported` / `browse_failed`) so the UI can toast the manual-input fallback. Darwin trailing-slash normalized off. Tests inject a fake `spawn` — real dialogs NEVER run in tests.
2. `src/launcher/recents.ts` — `loadRecents(path)` (corrupt/missing → `[]`), `addRecent(list, root, opts { cap: 10, now })` pure MRU (move-to-front, dedupe, cap), thin `readRecentsFile`/`writeRecentsFile` IO wrappers over `data/recents.json`.
3. Tests (`tests/launcher-browse.test.ts`, recents cases in `tests/launcher.test.ts` or `tests/launcher-recents.test.ts`): command builder per platform + unsupported OS; pickFolder cancelled/ok/unsupported/spaces+accents in path; recents MRU order, dedupe, cap, corrupt-file recovery, atomic write (tmp+rename).

**Verify:** `bun run repo:check` green; grep confirms no unguarded real-dialog invocation reachable from tests.

---

## Phase 2 — Launcher wiring: optional root, picker page, spawn-on-pick

**Tasks**

1. `launcher.ts` — root resolution: `--root` flag → explicit; `HARNESS_ROOT` env → explicit; **otherwise `null`** (cwd default retired per spec erratum). Pass `pickedRoot` state, recents file path, and injectable `pickFolder` into the app factory. `--online` args still forwarded to every engine spawn — spawn now happens on pick, so the pairing URL prints after selection (autoStart semantics preserved, deferred).
2. `src/launcher/app.ts` — `pickedRoot: string | null` in the launcher state:
   - `GET /api/recents` → current list;
   - `POST /api/browse` → `pickFolder` (injected) → `{ path }` | `{ cancelled: true }` | 500 `{ error: browse_unsupported | browse_failed }`;
   - `POST /api/root` `{ path }` → absolute + exists + isDirectory validation (400 + human message otherwise) → spawn engine (existing `spawnEngine` seam, same args as today) → `addRecent` → 200 `{ ok: true }`;
   - HTML routing: `pickedRoot === null` → picker page; once engine running → existing dashboard (unchanged).
3. `src/launcher/picker.ts` — standalone HTML page (same visual language as the dashboard): recents list (click = `POST /api/root`), **Examinar…** (`POST /api/browse`; cancelled → no-op; `browse_unsupported` → toast "usá el input de abajo"), manual absolute-path input + confirm (`POST /api/root`; 400 → toast), on success → `location.reload()` into the dashboard. Status polling (`/api/status`) unchanged once running.
4. Tests (extend `tests/launcher.test.ts` — fake spawn + fake browse + temp recents file):
   - no-root boot serves the picker HTML, `/api/status` still answers;
   - `POST /api/root` valid → engine spawned WITH that root (and online args when set), recents updated, page now serves dashboard;
   - invalid root (missing / relative / not a directory) → 400, still picker;
   - browse cancelled → stays on picker; browse unsupported → 500 with stable code;
   - explicit `--root` / `HARNESS_ROOT` → picker never served (regression guard);
   - autoStart-with-online: spawn deferred until pick, then pairing flow intact.

**Verify:** `bun run repo:check` green; manual smoke: `bun run launcher` (no root) → picker in browser → manual input of a fixture root (`tests/fixtures/mini-harness`) → dashboard renders that harness.

---

## Phase 3 — Bootstrap, docs, acceptance, commits

**Tasks**

1. `start-harness-manager.bat` — `cd /d "%~dp0" && bun run serve`; `start-harness-manager.sh` — `cd "$(dirname "$0")" && bun run serve` (+ `git update-index --chmod=+x`).
2. README — "Desktop entry" subsection: double-click paths per OS, optional hidden-console `wscript` one-liner for Windows (documented, not committed), macOS Finder `.command`/alias note, Linux desktop-launcher note; update the scan-root line that promises the cwd default.
3. `docs/acceptance.md` — L16 (double-click → picker), L17 (Examinar → engine → dashboard), L18 (recents MRU + invalid-path toast + manual input), L19 (POSIX `.sh` smoke).
4. Gate `bun run repo:check`; commits: `feat: launcher root picker with native OS dialogs` (code + tests + bootstrap) then `docs: root picker README, acceptance L16-L19, spec erratum` (README + acceptance + spec erratum).

**Verify:** `repo:check` exit 0; `git status` clean; user smoke L16–L18 on Windows; L19 on POSIX when available.

---

## Risks / open points

- **Windows PowerShell dialog + encoding**: non-ASCII paths (ñ, accents) through pipe stdout — mitigate with explicit UTF-8 output in the PS command; covered by a unit test on the builder + manual L16 with an accented fixture path.
- **cwd-default retirement** is a behavior change for anyone who ran `bun launcher.ts` bare inside a harness dir — README callout; `--root`/`HARNESS_ROOT`/engine CLI untouched.
- **Linux dialog variance** (no zenity/kdialog, WSL without dbus) — by design degrades to the manual input; never blocks.
- **Dialog process lifetime**: the browse request waits on a user-paced dialog (no short timeout); launcher is loopback-only, request is one-shot per click — acceptable; if it hangs the user can still use the manual input.
- **`.bat` console flash** — documented optional `wscript` hide; committing a `.vbs` stays out (spec §8).
- **AutoStart deferral** touches the `489be50` behavior — tests updated in Phase 2 must keep pairing-URL-after-pick semantics honest.
