import type { BrowseSpawnResult, PickFolderOptions } from '../src/launcher/browse.ts';
import { describe, expect, test } from 'bun:test';
import { browseCommand, pickFolder } from '../src/launcher/browse.ts';

/** Fake spawn: scripted queue in call order; an `Error` entry rejects (binary missing). */
function fakeSpawn(script: Array<BrowseSpawnResult | Error>) {
  const calls: string[][] = [];
  const spawn = async (cmd: string[]): Promise<BrowseSpawnResult> => {
    const index = calls.length;
    calls.push(cmd);
    const step = script[index] ?? { stdout: '', exitCode: 0 };
    if (step instanceof Error) { throw step; }
    return step;
  };
  return { calls, spawn };
}

async function expectBrowseError(opts: PickFolderOptions, code: string): Promise<void> {
  const error = await pickFolder(opts).then(
    () => null,
    (failure: unknown) => failure as Error & { code?: string },
  );
  expect(error).toBeInstanceOf(Error);
  expect(error?.code).toBe(code);
}

describe('browseCommand (pure per-OS builder)', () => {
  test('win32 → powershell FolderBrowserDialog with UTF-8 output, no secrets', () => {
    const plan = browseCommand('win32');
    expect(plan.kind).toBe('stdout');
    expect(plan.cmds).toHaveLength(1);
    const [bin, ...args] = plan.cmds[0];
    expect(bin).toBe('powershell');
    expect(args).toContain('-NoProfile');
    expect(args).toContain('-Command');
    const script = args[args.length - 1];
    expect(script).toContain('System.Windows.Forms');
    expect(script).toContain('FolderBrowserDialog');
    expect(script).toContain('Select harness root');
    expect(script).toContain('SelectedPath');
    expect(script).toContain('[Console]::OutputEncoding');
    expect(script).toContain('UTF8');
    expect(JSON.stringify(plan)).not.toMatch(/password|token|secret/i);
  });

  test('darwin → osascript choose folder', () => {
    const plan = browseCommand('darwin');
    expect(plan.kind).toBe('stdout');
    expect(plan.cmds).toEqual([
      ['osascript', '-e', 'POSIX path of (choose folder with prompt "Select harness root")'],
    ]);
  });

  test('linux → zenity primary + kdialog fallback, in order', () => {
    const plan = browseCommand('linux');
    expect(plan.kind).toBe('stdout');
    expect(plan.cmds).toHaveLength(2);
    expect(plan.cmds[0]).toEqual(['zenity', '--file-selection', '--directory', '--title=Select harness root']);
    expect(plan.cmds[1]).toEqual(['kdialog', '--getexistingdirectory', 'Select harness root']);
  });

  test('any other platform → unsupported', () => {
    const plan = browseCommand('freebsd');
    expect(plan.kind).toBe('unsupported');
    expect(plan.cmds).toEqual([]);
  });
});

describe('pickFolder', () => {
  test('win32 happy path: spaces + accented segment survives trim', async () => {
    const fake = fakeSpawn([{ stdout: 'C:\\Users\\Niño Pérez\\mis harnesses\r\n', exitCode: 0 }]);
    const picked = await pickFolder({ platform: 'win32', spawn: fake.spawn });
    expect(picked).toBe('C:\\Users\\Niño Pérez\\mis harnesses');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0][0]).toBe('powershell');
  });

  test('win32 cancel: exit 0 with empty stdout → null', async () => {
    const fake = fakeSpawn([{ stdout: '  \n', exitCode: 0 }]);
    expect(await pickFolder({ platform: 'win32', spawn: fake.spawn })).toBeNull();
  });

  test('win32 nonzero exit → browse_failed (script error, not a cancel)', async () => {
    const fake = fakeSpawn([{ stdout: '', exitCode: 1 }]);
    await expectBrowseError({ platform: 'win32', spawn: fake.spawn }, 'browse_failed');
  });

  test('win32 spawn rejection → browse_failed', async () => {
    const fake = fakeSpawn([new Error('ENOENT: powershell not found')]);
    await expectBrowseError({ platform: 'win32', spawn: fake.spawn }, 'browse_failed');
  });

  test('darwin happy path: trailing slash stripped from POSIX path', async () => {
    const fake = fakeSpawn([{ stdout: '/Users/josé/proyectos/harness/\n', exitCode: 0 }]);
    expect(await pickFolder({ platform: 'darwin', spawn: fake.spawn })).toBe('/Users/josé/proyectos/harness');
    expect(fake.calls[0][0]).toBe('osascript');
  });

  test('darwin user cancel (nonzero exit) → null without a path', async () => {
    const fake = fakeSpawn([{ stdout: '', exitCode: 1 }]);
    expect(await pickFolder({ platform: 'darwin', spawn: fake.spawn })).toBeNull();
    expect(fake.calls).toHaveLength(1);
  });

  test('darwin spawn rejection → browse_failed', async () => {
    const fake = fakeSpawn([new Error('ENOENT: osascript not found')]);
    await expectBrowseError({ platform: 'darwin', spawn: fake.spawn }, 'browse_failed');
  });

  test('linux: zenity succeeds first (never reaches kdialog)', async () => {
    const fake = fakeSpawn([{ stdout: '/home/ana/harnesses demo\n', exitCode: 0 }]);
    expect(await pickFolder({ platform: 'linux', spawn: fake.spawn })).toBe('/home/ana/harnesses demo');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0][0]).toBe('zenity');
  });

  test('linux: zenity missing → falls back to kdialog', async () => {
    const fake = fakeSpawn([new Error('ENOENT: zenity not found'), { stdout: '/opt/harness\n', exitCode: 0 }]);
    expect(await pickFolder({ platform: 'linux', spawn: fake.spawn })).toBe('/opt/harness');
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0][0]).toBe('zenity');
    expect(fake.calls[1][0]).toBe('kdialog');
  });

  test('linux: both dialogs exit nonzero (user cancelled) → null, both attempted', async () => {
    const fake = fakeSpawn([{ stdout: '', exitCode: 1 }, { stdout: '', exitCode: 1 }]);
    expect(await pickFolder({ platform: 'linux', spawn: fake.spawn })).toBeNull();
    expect(fake.calls).toHaveLength(2);
  });

  test('linux: both binaries missing (spawn throws) → browse_unsupported', async () => {
    const fake = fakeSpawn([new Error('ENOENT: zenity'), new Error('ENOENT: kdialog')]);
    await expectBrowseError({ platform: 'linux', spawn: fake.spawn }, 'browse_unsupported');
    expect(fake.calls).toHaveLength(2);
  });

  test('linux: exit 0 with empty stdout → null', async () => {
    const fake = fakeSpawn([{ stdout: ' \n', exitCode: 0 }]);
    expect(await pickFolder({ platform: 'linux', spawn: fake.spawn })).toBeNull();
  });

  test('unsupported platform → browse_unsupported, spawn never called', async () => {
    const fake = fakeSpawn([]);
    await expectBrowseError({ platform: 'freebsd', spawn: fake.spawn }, 'browse_unsupported');
    expect(fake.calls).toHaveLength(0);
  });

  test('platform override wins over process.platform (osascript on this host)', async () => {
    const fake = fakeSpawn([{ stdout: '/tmp/raíz/\n', exitCode: 0 }]);
    expect(await pickFolder({ platform: 'darwin', spawn: fake.spawn })).toBe('/tmp/raíz');
    expect(fake.calls[0][0]).toBe('osascript');
  });
});
