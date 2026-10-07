/** Best-effort OS-open of a file already guarded inside the harness root. Never throws. */
export function openInOs(absPath: string): { ok: boolean } {
  try {
    if (process.platform === 'win32') {
      // `start` treats the first quoted arg as the window title → pass "" explicitly.
      Bun.spawn(['cmd', '/c', 'start', '', absPath], { stdout: 'ignore', stderr: 'ignore' });
    }
    else if (process.platform === 'darwin') {
      Bun.spawn(['open', absPath], { stdout: 'ignore', stderr: 'ignore' });
    }
    else {
      Bun.spawn(['xdg-open', absPath], { stdout: 'ignore', stderr: 'ignore' });
    }
    return { ok: true };
  }
  catch {
    return { ok: false };
  }
}
