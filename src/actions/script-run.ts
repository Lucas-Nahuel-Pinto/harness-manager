import type { ActionResult, ApiBody } from './types.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../scan/jsonc.ts';
import { errorResult } from './types.ts';

const MAX_OUTPUT = 200_000;
const TIMEOUT_MS = 30_000;

/**
 * Run a script DECLARED in the harness `package.json` — never an arbitrary command string.
 * `cwd = harness root`, stdout+stderr captured, 30s hard timeout. Validation problems are 4xx;
 * a run that happened answers 200 with `ok` + `exitCode` (timeout → ok:false, error:'timeout').
 */
export async function runScript(rootAbs: string, name: unknown): Promise<ActionResult> {
  if (typeof name !== 'string' || name.length === 0) {
    return errorResult(400, 'bad_body', 'se espera { name }');
  }
  if (name.startsWith('-') || /[\\/]/.test(name)) {
    return errorResult(400, 'invalid_script_name', `nombre de script inválido: ${name}`);
  }

  const pkgPath = join(rootAbs, 'package.json');
  if (!existsSync(pkgPath)) { return errorResult(400, 'package_not_found', 'el harness no tiene package.json'); }
  const parsed = parseJsonc<{ scripts?: Record<string, string> }>(readFileSync(pkgPath, 'utf8'));
  if (!parsed.value) { return errorResult(400, 'config_invalid', `package.json: ${parsed.error}`); }
  const scripts = parsed.value.scripts ?? {};
  if (!(name in scripts)) {
    return errorResult(400, 'script_not_found', `"${name}" no está en scripts de package.json`);
  }

  let timedOut = false;
  const proc = Bun.spawn(['bun', 'run', name], {
    cwd: rootAbs,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill(); }
    catch { /* already exited */ }
  }, TIMEOUT_MS);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  const output = cap([stdout, stderr].filter(Boolean).join('\n'));
  if (timedOut) {
    const body: ApiBody = { ok: false, error: 'timeout', detail: `el script superó ${TIMEOUT_MS / 1000}s y fue terminado`, output, exitCode: null };
    return { status: 200, body };
  }
  return { status: 200, body: { ok: exitCode === 0, output, exitCode } };
}

function cap(text: string): string {
  if (text.length <= MAX_OUTPUT) { return text; }
  return `${text.slice(0, MAX_OUTPUT)}\n… [salida truncada en ${MAX_OUTPUT} caracteres]`;
}
