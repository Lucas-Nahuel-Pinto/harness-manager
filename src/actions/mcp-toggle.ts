import type { ComputeResult } from './types.ts';
import { existsSync, readFileSync } from 'node:fs';
import { parseJsonc } from '../scan/jsonc.ts';
import { resolveInRoot } from './guard.ts';
import { locatePath, skipTrivia } from './locate.ts';
import { fail, okEdit } from './types.ts';

export const MCP_CONFIG_FILES = ['opencode.jsonc', '.mcp.json'];

/**
 * JSONC-preserving toggle — marker semantics (D1, approved):
 * - disable: insert `"enabled": false` as the FIRST property of the entry (opencode documents
 *   this exact flag: "disable a server without removing it from your config")
 * - enable: delete the `enabled` key line and repair the previous property's trailing comma
 *   when we removed the last property
 * Everything else stays byte-for-byte, so comments survive an off→on roundtrip.
 * Every candidate edit is re-parsed and structurally compared BEFORE it can reach a write.
 */
export function computeMcpToggle(rootAbs: string, payload: Record<string, unknown>): ComputeResult {
  const { configFile, name, enable } = payload;
  if (typeof configFile !== 'string' || !MCP_CONFIG_FILES.includes(configFile)) {
    return fail(400, 'bad_payload', `configFile debe ser ${MCP_CONFIG_FILES.join(' o ')}`);
  }
  if (typeof name !== 'string' || name.length === 0) { return fail(400, 'bad_payload', 'name vacío'); }
  if (typeof enable !== 'boolean') { return fail(400, 'bad_payload', 'enable debe ser boolean'); }

  const absPath = resolveInRoot(rootAbs, configFile);
  if (!absPath) { return fail(400, 'path_escape', `ruta fuera del harness root: ${configFile}`); }
  if (!existsSync(absPath)) { return fail(400, 'config_not_found', `no existe ${configFile} en el harness`); }

  const text = readFileSync(absPath, 'utf8');
  const parsed = parseJsonc<Record<string, unknown>>(text);
  if (!parsed.value) { return fail(400, 'config_invalid', `${configFile}: ${parsed.error}`); }

  const sectionKey = parsed.value.mcp !== undefined ? 'mcp' : 'mcpServers';
  const container = parsed.value[sectionKey] as Record<string, unknown> | undefined;
  if (!container || typeof container !== 'object') { return fail(400, 'no_mcp_section', `${configFile} no tiene sección "mcp"/"mcpServers"`); }
  if (!(name in container)) { return fail(400, 'mcp_not_found', `MCP "${name}" no está en ${configFile}`); }
  const def = container[name];
  if (!def || typeof def !== 'object' || Array.isArray(def)) { return fail(400, 'invalid_mcp_entry', `la entrada "${name}" no es un objeto`); }

  const currentEnabled = (def as Record<string, unknown>).enabled !== false;
  const summary = `${enable ? 'Habilitar' : 'Deshabilitar'} MCP "${name}" en ${configFile}`;
  if (currentEnabled === enable) {
    return okEdit({ relPath: configFile, absPath, oldText: text, newText: text, summary: `${summary} (sin cambios)` });
  }

  const entry = locatePath(text, [sectionKey, name]);
  if (!entry) { return fail(400, 'edit_unsafe', `no se pudo localizar la entrada "${name}" en ${configFile}`); }
  if (text[entry.valueStart] !== '{') { return fail(400, 'invalid_mcp_entry', `la entrada "${name}" no es un objeto`); }

  const foundEnabled = locatePath(text, [sectionKey, name, 'enabled']);
  let newText: string | null;
  if (enable) {
    if (!foundEnabled) { return okEdit({ relPath: configFile, absPath, oldText: text, newText: text, summary: `${summary} (sin cambios)` }); }
    newText = removeEnabledKey(text, entry.valueStart + 1, entry.valueEnd - 1, foundEnabled);
  }
  else if (foundEnabled) {
    newText = `${text.slice(0, foundEnabled.valueStart)}false${text.slice(foundEnabled.valueEnd)}`;
  }
  else {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    newText = insertEnabledKey(text, entry, eol);
  }

  if (newText === null) { return fail(400, 'edit_unsafe', `no se pudo editar la entrada "${name}" sin romper el archivo`); }

  const validation = validateToggle(parsed.value, newText, name, sectionKey, enable);
  if (validation) { return fail(400, 'edit_unsafe', validation); }

  return okEdit({ relPath: configFile, absPath, oldText: text, newText, summary });
}

interface EntryLoc {
  keyStart: number
  valueStart: number
  valueEnd: number
}

/** Insert `"enabled": false` right after the entry's `{` — comments elsewhere untouched. */
function insertEnabledKey(text: string, entry: EntryLoc, eol: string): string {
  const innerStart = entry.valueStart + 1;
  const innerEnd = entry.valueEnd - 1;
  const body = text.slice(innerStart, innerEnd);
  const firstSig = body[skipTrivia(body, 0)] ?? '';
  const needsComma = firstSig === '"'; // a property follows → separator; never emit a trailing comma

  const keyLineStart = text.lastIndexOf('\n', entry.keyStart - 1) + 1;
  const keyIndent = /^[ \t]*/.exec(text.slice(keyLineStart, entry.keyStart))?.[0] ?? '';
  const innerIndent = `${keyIndent}  `;

  if (text[innerStart] === '\n') {
    const insert = `${innerIndent}"enabled": false${needsComma ? ',' : ''}${eol}`;
    return `${text.slice(0, innerStart + 1)}${insert}${text.slice(innerStart + 1)}`;
  }
  if (text[innerStart] === '\r' && text[innerStart + 1] === '\n') {
    const insert = `${innerIndent}"enabled": false${needsComma ? ',' : ''}${eol}`;
    return `${text.slice(0, innerStart + 2)}${insert}${text.slice(innerStart + 2)}`;
  }
  const insert = needsComma ? '"enabled": false, ' : '"enabled": false';
  return `${text.slice(0, innerStart)}${insert}${text.slice(innerStart)}`;
}

/** Delete the `enabled` key line(s); repair the previous trailing comma when we removed the last property. */
function removeEnabledKey(text: string, innerStart: number, innerEnd: number, enabled: EntryLoc): string | null {
  const lineStart = text.lastIndexOf('\n', enabled.keyStart - 1) + 1;
  const prefix = text.slice(lineStart, enabled.keyStart);
  const wholeLine = prefix.trim().length === 0;
  const removalStart = wholeLine ? lineStart : enabled.keyStart;

  let removalEnd = enabled.valueEnd;
  let consumedComma = false;
  let scan = removalEnd;
  while (scan < text.length && (text[scan] === ' ' || text[scan] === '\t')) { scan++; }
  if (text[scan] === ',') { removalEnd = scan + 1; consumedComma = true; }

  let start = removalStart;
  if (!consumedComma) {
    let back = removalStart - 1;
    while (back > innerStart && /\s/.test(text[back])) { back--; }
    if (back >= innerStart && text[back] === ',') { start = back; }
  }
  // whole-line key + consumed comma → also eat the trailing newline, so a disable→enable
  // roundtrip restores the original bytes exactly (no doubled blank line)
  if (wholeLine && consumedComma) {
    if (text[removalEnd] === '\r' && text[removalEnd + 1] === '\n') { removalEnd += 2; }
    else if (text[removalEnd] === '\n') { removalEnd += 1; }
  }
  if (start < innerStart || removalEnd > innerEnd + 1) { return null; }
  return text.slice(0, start) + text.slice(removalEnd);
}

/** Safety net: candidate text must parse AND deep-equal the expected structure (key order insensitive). */
function validateToggle(
  oldParsed: Record<string, unknown>,
  newText: string,
  name: string,
  sectionKey: string,
  enable: boolean,
): string | null {
  const reparsed = parseJsonc<Record<string, unknown>>(newText);
  if (!reparsed.value) { return `el edit deja JSON inválido: ${reparsed.error}`; }

  const expected = JSON.parse(JSON.stringify(oldParsed)) as Record<string, unknown>;
  const expectedSection = expected[sectionKey] as Record<string, unknown>;
  const expectedEntry = expectedSection[name] as Record<string, unknown>;
  if (enable) { delete expectedEntry.enabled; }
  else { expectedEntry.enabled = false; }

  if (!deepEqual(reparsed.value, expected)) { return 'la estructura resultante no coincide con la esperada'; };
  return null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) { return true; }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every(key => key in right && deepEqual(left[key], right[key]));
  }
  return false;
}
