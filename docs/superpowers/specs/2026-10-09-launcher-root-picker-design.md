# Harness Manager Launcher Root Picker — Design

## 1. Problem

Starting harness-manager always requires a terminal: open bash in the repo, run `bun run serve --root <path>`. The launcher web UI already owns the engine lifecycle (Iniciar/Detener), but nothing owns the very first step — picking WHICH harness to manage — without bash.

## 2. Goal

Double-click a desktop entry → a picker page opens in the browser → choose the harness root (recent list or native OS folder dialog) → launcher spawns the engine with that root → the page becomes the existing dashboard. Zero terminal interaction. No harness switching while running (restart the launcher to change root — explicit scope cut).

```
.blnk/.bat/.sh  →  bun run serve (no --root)  →  picker page @ 127.0.0.1:7397
                                                 │ GET  /api/recents
                                                 │ POST /api/browse   (native OS dialog)
                                                 │ POST /api/root     → spawn engine
                                                 └─ page swaps to existing dashboard
```

## 3. Binding decisions

1. **Picker lives in the launcher** (option B approved): no new stack, no Electron, same process that already serves the dashboard.
2. **`rootAbs` becomes optional** in `launcher.ts`/`src/launcher/app.ts`. No root → no engine spawn; state `pickedRoot: string | null`. Existing explicit-root flows (`--root`, `HARNESS_ROOT`, cwd default, `--online` autoStart) are UNCHANGED — they skip the picker entirely.
3. **Browser cannot resolve folder paths** (File System Access / `webkitdirectory` hide absolute paths), so "Examinar…" asks the LAUNCHER to open a native dialog server-side (`src/launcher/browse.ts`, per-OS switch):
   - **Windows**: PowerShell `System.Windows.Forms.FolderBrowserDialog` → `SelectedPath` on stdout; empty stdout = cancelled.
   - **macOS**: `osascript -e 'POSIX path of (choose folder with prompt "Select harness root")'`; user-cancel (exit ≠ 0) = cancelled.
   - **Linux**: `zenity --file-selection --directory` with `kdialog --getexistingdirectory` fallback; neither present → command unsupported (step 5 fallback).
   - Dialog waits are user-paced: no short timeout; stdout is read fully, process exit checked.
4. **Universal fallback = manual path input** on the picker page (always visible). Native dialog unavailable or cancelled → user types/pastes an absolute path. Nothing is blocked without a dialog.
5. **Recents**: `data/recents.json` (already gitignored dir) — absolute paths, MRU order, dedupe, cap 10, `lastUsed` timestamps; updated on every successful engine spawn.
6. **Root validation** on `POST /api/root`: absolute path, exists, is a directory (per-OS: `existsSync` + `statSync().isDirectory()`), else 400 with a human message. All picker endpoints stay loopback-only (existing launcher binding).
7. **Bootstrap artifacts** (committed): `start-harness-manager.bat` (Windows — `cd /d "%~dp0" && bun run serve`) and `start-harness-manager.sh` (POSIX — `cd "$(dirname "$0")" && bun run serve`, documented `chmod +x`). Desktop `.lnk`/Finder alias creation is a README instruction, not a committed binary. `.lnk`-free Windows path: the `.bat` itself is double-clickable (optionally launched hidden via a documented `wscript` one-liner to kill the console flash).
8. **`--online` interaction**: root chosen first (picker), THEN the engine spawns with the forwarded online args — pairing URL prints only after a root exists. AutoStart semantics from `489be50` hold, just deferred past the pick.

## 4. Components

| File | Change |
| --- | --- |
| `launcher.ts` | `rootAbs` optional; defer engine spawn; pass recents/browse/root handlers into the app factory |
| `src/launcher/app.ts` | `pickedRoot` state; routes `GET /api/recents`, `POST /api/browse`, `POST /api/root`; serve picker page when `pickedRoot === null` (and engine down); dashboard once running |
| `src/launcher/browse.ts` | NEW — per-OS native folder dialog (`pickFolder(): Promise<string \| null>`); Windows/macOS/Linux + unsupported signal |
| `src/launcher/picker.ts` | NEW — picker HTML page (recents list, Examinar…, manual input, same visual language as the dashboard) |
| `data/recents.json` | runtime state, gitignored; read/write helpers beside the picker logic |
| `start-harness-manager.bat` / `.sh` | NEW — double-click/one-command bootstrap |
| `tests/launcher.test.ts` | extended (see §6) |
| `docs/acceptance.md` | L16–L19 picker checklist |
| `README.md` | "Desktop entry" subsection |

## 5. Error handling

- Browse dialog cancelled → `{ cancelled: true }`, UI stays put.
- Browse unsupported (no zenity/kdialog) → UI toast: use the manual input.
- Invalid root → 400 + toast; user stays on the picker.
- Engine fails to start after a valid root → existing engine-error surface; `pickedRoot` stays so the user can retry Iniciar or re-open the launcher.
- `data/recents.json` corrupt/missing → treat as empty, rewrite on next update.
- Root deleted after pick but before spawn → 400, same as invalid.

## 6. Testing

- Unit (`tests/launcher.test.ts` + browse tests): recents MRU (dedupe, cap 10, order); root validation (missing, file-not-dir, relative path rejected); `browseCommand(os)` pure builder per platform; picker-vs-dashboard route decision; `POST /api/root` happy path spawns engine (fake spawn seam already in launcher tests) + updates recents; cancel path.
- Network isolation: native dialogs are never executed in tests (command builder is pure; `pickFolder` seam injectable like `spawnEngine`).
- Manual acceptance L16 (double-click → picker), L17 (Examinar → engine → dashboard), L18 (recents order + invalid path toast), L19 (`.sh` on POSIX smoke).

## 7. Non-goals

Runtime harness switching, tray icon, OS autostart, `.exe` packaging, embedding the picker into the dashboard (post-start), multi-root concurrent engines.

## 8. Open items

- Whether the Windows `.bat` should ship a companion hidden-start `.vbs` (console flash) — decide in the plan; default = document it, don't commit the `.vbs`.
- Linux dialog availability varies by distro/desktop — manual input is the guaranteed path; zenity/kdialog are opportunistic.
