/**
 * NATIVE FOLDER BROWSE — per-OS dialog command builder + injectable runner (spec §3.3).
 *
 * `browseCommand` is pure: argv arrays are built without touching the OS, so tests
 * never open a real dialog. `pickFolder` runs the builder's commands through an
 * injectable spawn seam — cancel resolves `null`; unsupported platforms, missing
 * dialog binaries, or spawn failures throw an Error with a stable `.code`
 * (`browse_unsupported` / `browse_failed`) so the picker UI can toast the
 * manual-input fallback (spec §5).
 */

/** Ordered argv attempts (primary first, optional fallback after). Empty when unsupported. */
export interface BrowseCommand {
  cmds: string[][]
  kind: 'stdout' | 'unsupported'
}

export interface BrowseSpawnResult {
  stdout: string
  exitCode: number
}

export interface PickFolderOptions {
  /** Defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** DI — tests inject a fake; the default uses Bun.spawn (real dialog, never run in tests). */
  spawn?: (cmd: string[]) => Promise<BrowseSpawnResult>
}

export type BrowseErrorCode = 'browse_unsupported' | 'browse_failed';

const DIALOG_PROMPT = 'Select harness root';

/** Windows: FolderBrowserDialog via PowerShell — SelectedPath printed only on OK; UTF-8 forced so accented paths survive the pipe; empty stdout = cancelled. */
const WIN32_SCRIPT = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = '${DIALOG_PROMPT}'; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }`;

/** Pure per-OS builder: win32/darwin/linux → stdout-producing command(s); anything else → unsupported. */
export function browseCommand(platform: NodeJS.Platform): BrowseCommand {
  if (platform === 'win32') {
    return { kind: 'stdout', cmds: [['powershell', '-NoProfile', '-Command', WIN32_SCRIPT]] };
  }
  if (platform === 'darwin') {
    return { kind: 'stdout', cmds: [['osascript', '-e', `POSIX path of (choose folder with prompt "${DIALOG_PROMPT}")`]] };
  }
  if (platform === 'linux') {
    return {
      kind: 'stdout',
      cmds: [
        ['zenity', '--file-selection', '--directory', `--title=${DIALOG_PROMPT}`],
        ['kdialog', '--getexistingdirectory', DIALOG_PROMPT],
      ],
    };
  }
  return { kind: 'unsupported', cmds: [] };
}

/** Real dialog runner: Bun.spawn with stdout captured and exit awaited (user-paced, no timeout). */
async function defaultSpawn(cmd: string[]): Promise<BrowseSpawnResult> {
  const proc = Bun.spawn(cmd, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

function browseError(code: BrowseErrorCode, message: string): Error {
  const error = new Error(message) as Error & { code: BrowseErrorCode };
  error.code = code;
  return error;
}

function messageText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Trim, strip the macOS POSIX trailing `/`, empty result → null (cancelled). */
function normalizePath(platform: NodeJS.Platform, raw: string): string | null {
  let path = raw.trim();
  if (platform === 'darwin') { path = path.replace(/\/$/, ''); }
  return path === '' ? null : path;
}

/**
 * Open the native folder dialog and resolve the picked absolute path, or `null`
 * when the user cancels (win32 empty stdout; darwin/linux nonzero exit without a path).
 * Linux tries zenity then kdialog; no dialog binary at all → `browse_unsupported`.
 * Spawn failure on win32/darwin → `browse_failed`.
 */
export async function pickFolder(opts: PickFolderOptions = {}): Promise<string | null> {
  const platform = opts.platform ?? process.platform;
  const spawn = opts.spawn ?? defaultSpawn;
  const plan = browseCommand(platform);
  if (plan.kind === 'unsupported') {
    throw browseError('browse_unsupported', `diálogo de carpetas no soportado en ${platform}`);
  }

  if (platform === 'linux') {
    let sawNonzero = false;
    for (const cmd of plan.cmds) {
      try {
        const result = await spawn(cmd);
        if (result.exitCode !== 0) { sawNonzero = true; continue; }
        return normalizePath(platform, result.stdout);
      }
      catch { continue; } // dialog binary missing — try the next candidate
    }
    if (sawNonzero) { return null; } // dialog ran but produced no path → user cancelled
    throw browseError('browse_unsupported', 'zenity y kdialog no disponibles');
  }

  const result = await spawn(plan.cmds[0]).catch((error: unknown) => {
    throw browseError('browse_failed', `no se pudo abrir el diálogo de carpetas: ${messageText(error)}`);
  });
  if (platform === 'win32' && result.exitCode !== 0) {
    throw browseError('browse_failed', `powershell falló (exit ${result.exitCode})`);
  }
  if (result.exitCode !== 0) { return null; } // darwin: user pressed Cancel/Esc
  return normalizePath(platform, result.stdout);
}
