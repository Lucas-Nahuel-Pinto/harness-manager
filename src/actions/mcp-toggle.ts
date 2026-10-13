import type { ComputeResult } from './types.ts';
import { existsSync, readFileSync } from 'node:fs';
import { parseJsonc } from '../scan/jsonc.ts';
import { CONVENTION } from '../scan/manifest.ts';
import { resolveInRoot } from './guard.ts';
import { locatePath, readString, rootEnd, skipTrivia } from './locate.ts';
import { fail, okEdit } from './types.ts';

export const MCP_CONFIG_FILES = ['opencode.jsonc', '.mcp.json'];

/**
 * JSONC-preserving toggle — marker semantics (D1, approved):
 * - opencode.jsonc: disable inserts `"enabled": false` as the FIRST property of the entry
 *   (opencode documents this exact flag); enable deletes the `enabled` key line and repairs the
 *   previous property's trailing comma. Everything else stays byte-for-byte, so comments survive
 *   an off→on roundtrip.
 * - .mcp.json: Claude Code has no `enabled` key in that schema and silently ignores it, so the
 *   toggle writes the server name into `disabledMcpjsonServers` of `.claude/settings.json` — the
 *   mechanism Claude Code actually honors (rejection beats every enable list; spec 2026-10-13).
 *   A legacy `"enabled": false` marker inside the entry still reads as disabled and is stripped
 *   on the next enable.
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

  if (configFile === '.mcp.json') {
    return computeClaudeToggle(rootAbs, absPath, text, configFile, sectionKey, parsed.value, def as Record<string, unknown>, name, enable);
  }

  // opencode.jsonc — the `enabled: false` marker, honored by opencode in place
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

/**
 * `.mcp.json` route (spec 2026-10-13): Claude Code ignores the entry-level `enabled` key, so the
 * toggle maintains `disabledMcpjsonServers` in `.claude/settings.json` instead. Single-file edit
 * per action — the pipeline contract (one guarded file, atomic write, rescan) stays untouched.
 */
function computeClaudeToggle(
  rootAbs: string,
  configAbs: string,
  configText: string,
  configFile: string,
  sectionKey: string,
  parsedConfig: Record<string, unknown>,
  def: Record<string, unknown>,
  name: string,
  enable: boolean,
): ComputeResult {
  const settingsRel = CONVENTION.claudeSettings;
  const settingsKey = CONVENTION.claudeDisabledServers;
  const settingsAbs = resolveInRoot(rootAbs, settingsRel);
  if (!settingsAbs) { return fail(400, 'path_escape', `ruta fuera del harness root: ${settingsRel}`); }

  let settingsText = '';
  let settingsParsed: Record<string, unknown> | null = null;
  if (existsSync(settingsAbs)) {
    settingsText = readFileSync(settingsAbs, 'utf8');
    const parsed = parseJsonc<Record<string, unknown>>(settingsText);
    if (!parsed.value) { return fail(400, 'config_invalid', `${settingsRel}: ${parsed.error}`); }
    if (typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return fail(400, 'config_invalid', `${settingsRel}: la raíz no es un objeto`);
    }
    settingsParsed = parsed.value;
  }

  const listed = settingsParsed?.[settingsKey];
  if (listed !== undefined && (!Array.isArray(listed) || listed.some(item => typeof item !== 'string'))) {
    return fail(400, 'config_invalid', `${settingsRel}: ${settingsKey} debe ser un array de strings`);
  }
  const inDisabled = Array.isArray(listed) && (listed as unknown[]).includes(name);

  const legacyMarker = def.enabled === false;
  const currentEnabled = !inDisabled && !legacyMarker;
  const what = enable ? 'Habilitar' : 'Deshabilitar';

  if (currentEnabled === enable) {
    // report the file that actually holds the state we saw
    if (inDisabled) {
      const summary = `${what} MCP "${name}" — ya listado en ${settingsRel}`;
      return okEdit({ relPath: settingsRel, absPath: settingsAbs, oldText: settingsText, newText: settingsText, summary: `${summary} (sin cambios)` });
    }
    const summary = `${what} MCP "${name}" — estado ya reflejado en ${configFile}`;
    return okEdit({ relPath: configFile, absPath: configAbs, oldText: configText, newText: configText, summary: `${summary} (sin cambios)` });
  }

  if (enable) {
    if (inDisabled) {
      const summary = `Habilitar MCP "${name}" — quitar de ${settingsRel} → ${settingsKey}`;
      const newText = removeDisabledSetting(settingsText, settingsParsed as Record<string, unknown>, name);
      if (newText === null) { return fail(400, 'edit_unsafe', `no se pudo editar ${settingsRel} sin romperlo`); }
      const validation = validateSettingsToggle(settingsParsed as Record<string, unknown>, newText, name, true);
      if (validation) { return fail(400, 'edit_unsafe', validation); }
      return okEdit({ relPath: settingsRel, absPath: settingsAbs, oldText: settingsText, newText, summary });
    }
    // legacy `enabled: false` marker inside the entry — strip it (the only reachable enable path)
    const summary = `Habilitar MCP "${name}" — quitar el marcador legacy de ${configFile}`;
    const entry = locatePath(configText, [sectionKey, name]);
    const foundEnabled = entry ? locatePath(configText, [sectionKey, name, 'enabled']) : null;
    if (!entry || !foundEnabled) { return fail(400, 'edit_unsafe', `no se pudo localizar el marcador legacy de "${name}" en ${configFile}`); }
    const newText = removeEnabledKey(configText, entry.valueStart + 1, entry.valueEnd - 1, foundEnabled);
    if (newText === null) { return fail(400, 'edit_unsafe', `no se pudo editar ${configFile} sin romperlo`); }
    const validation = validateToggle(parsedConfig, newText, name, sectionKey, true);
    if (validation) { return fail(400, 'edit_unsafe', validation); }
    return okEdit({ relPath: configFile, absPath: configAbs, oldText: configText, newText, summary });
  }

  const summary = `Deshabilitar MCP "${name}" — agregar a ${settingsRel} → ${settingsKey}`;
  const newText = insertDisabledSetting(settingsText, settingsParsed, name);
  if (newText === null) { return fail(400, 'edit_unsafe', `no se pudo editar ${settingsRel} sin romperlo`); }
  const validation = validateSettingsToggle(settingsParsed ?? {}, newText, name, false);
  if (validation) { return fail(400, 'edit_unsafe', validation); }
  return okEdit({ relPath: settingsRel, absPath: settingsAbs, oldText: settingsText, newText, summary });
}

/** Add `name` to disabledMcpjsonServers — create file / insert first key / append element. */
function insertDisabledSetting(text: string, parsed: Record<string, unknown> | null, name: string): string | null {
  const key = CONVENTION.claudeDisabledServers;
  const encoded = JSON.stringify(name);
  if (!parsed) {
    // brand-new settings file — minimal scaffold, LF
    return `{\n  "${key}": [${encoded}]\n}\n`;
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const loc = locatePath(text, [key]);
  if (!loc) {
    // insert the key as the FIRST root property — same comma rules as the marker insert
    const start = skipTrivia(text, 0);
    if (text[start] !== '{') { return null; }
    const pos = skipTrivia(text, start + 1);
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
    const keyIndent = /^[ \t]*/.exec(text.slice(lineStart, pos))?.[0] || '  ';
    const multiline = /\r?\n/.test(text.slice(start + 1, pos));
    const property = `"${key}": [${encoded}]`;
    if (text[pos] === '}') {
      return `${text.slice(0, pos)}${eol}${keyIndent}${property}${eol}${text.slice(pos)}`;
    }
    return `${text.slice(0, pos)}${property},${multiline ? `${eol}${keyIndent}` : ' '}${text.slice(pos)}`;
  }

  // key exists → append the element at the END of the array: comma-backward removal then
  // restores the original bytes on a disable→enable roundtrip
  const items = arrayItemSpans(text, loc);
  if (items === null) { return null; }
  const closeBracket = loc.valueEnd - 1;
  if (items.length === 0) {
    return `${text.slice(0, closeBracket)}${encoded}${text.slice(closeBracket)}`;
  }
  const last = items[items.length - 1];
  const lastLineStart = text.lastIndexOf('\n', last.start - 1) + 1;
  const elemIndent = /^[ \t]*/.exec(text.slice(lastLineStart, last.start))?.[0] ?? '';
  const multiline = /\r?\n/.test(text.slice(last.end, closeBracket));
  const afterLast = skipTrivia(text, last.end);
  if (text[afterLast] === ',') {
    // pre-existing trailing comma — append after it without adding another
    const insertAt = skipTrivia(text, afterLast + 1);
    return `${text.slice(0, insertAt)}${multiline ? `${eol}${elemIndent}` : ' '}${encoded}${text.slice(insertAt)}`;
  }
  if (text[afterLast] !== ']') { return null; }
  const separator = multiline ? `,${eol}${elemIndent}` : ', ';
  return `${text.slice(0, last.end)}${separator}${encoded}${text.slice(last.end)}`;
}

/** Remove `name` from disabledMcpjsonServers; drops the whole key when the array would empty. */
function removeDisabledSetting(text: string, parsed: Record<string, unknown>, name: string): string | null {
  const key = CONVENTION.claudeDisabledServers;
  const loc = locatePath(text, [key]);
  if (!loc) { return null; }
  const items = arrayItemSpans(text, loc);
  if (items === null) { return null; }
  const index = items.findIndex(span => safeJsonParse(text.slice(span.start, span.end)) === name);
  if (index === -1) { return null; }

  const remaining = (parsed[key] as unknown[]).filter(item => item !== name);
  if (remaining.length === 0) {
    // the key itself goes away → byte-exact roundtrip for the create-then-enable flow
    const start = skipTrivia(text, 0);
    const end = rootEnd(text);
    if (text[start] !== '{' || end === null) { return null; }
    return removeEnabledKey(text, start + 1, end - 1, loc);
  }

  const { start, end } = items[index];
  const after = skipTrivia(text, end);
  if (text[after] === ',') {
    // middle element — consume the comma plus the IMMEDIATE line break + indent (what we
    // insert on append); a comment after the comma stays untouched
    let removalEnd = after + 1;
    if (text[removalEnd] === '\r' && text[removalEnd + 1] === '\n') { removalEnd += 2; }
    else if (text[removalEnd] === '\n') { removalEnd += 1; }
    while (text[removalEnd] === ' ' || text[removalEnd] === '\t') { removalEnd++; }
    return text.slice(0, start) + text.slice(removalEnd);
  }
  // last element — consume the preceding comma (keeps append→remove byte-exact)
  let back = start - 1;
  while (back > loc.valueStart && /\s/.test(text[back])) { back--; }
  if (text[back] !== ',') { return null; }
  return text.slice(0, back) + text.slice(start);
}

interface ItemSpan {
  start: number
  end: number
}

/** Byte spans of the top-level string items of an array value; null on any non-string item. */
function arrayItemSpans(text: string, loc: { valueStart: number, valueEnd: number }): ItemSpan[] | null {
  const spans: ItemSpan[] = [];
  let i = skipTrivia(text, loc.valueStart + 1);
  while (i < loc.valueEnd - 1) {
    if (text[i] === ']') { break; }
    if (text[i] === ',') { i = skipTrivia(text, i + 1); continue; }
    if (text[i] !== '"') { return null; }
    const end = readString(text, i);
    if (end === -1) { return null; }
    spans.push({ start: i, end });
    i = skipTrivia(text, end);
  }
  return spans;
}

function safeJsonParse(text: string): unknown {
  try { return JSON.parse(text); }
  catch { return undefined; }
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
  // only-property key (no comma either side) → eat the surrounding newlines as well, so
  // removing a key we created restores `{}` byte-exact instead of leaving a stray blank line
  if (wholeLine && !consumedComma && start === removalStart) {
    if (text[removalEnd] === '\r' && text[removalEnd + 1] === '\n') { removalEnd += 2; }
    else if (text[removalEnd] === '\n') { removalEnd += 1; }
    if (text[start - 2] === '\r' && text[start - 1] === '\n') { start -= 2; }
    else if (text[start - 1] === '\n') { start -= 1; }
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

/** Same safety net for `.claude/settings.json`: array gains/loses exactly `name`, key dropped when empty. */
function validateSettingsToggle(
  oldParsed: Record<string, unknown>,
  newText: string,
  name: string,
  enable: boolean,
): string | null {
  const reparsed = parseJsonc<Record<string, unknown>>(newText);
  if (!reparsed.value) { return `el edit deja JSON inválido: ${reparsed.error}`; }

  const key = CONVENTION.claudeDisabledServers;
  const expected = JSON.parse(JSON.stringify(oldParsed)) as Record<string, unknown>;
  if (enable) {
    const list = (expected[key] as string[] | undefined) ?? [];
    const filtered = list.filter(item => item !== name);
    if (filtered.length === 0) { delete expected[key]; }
    else { expected[key] = filtered; }
  }
  else {
    expected[key] = [...((expected[key] as string[] | undefined) ?? []), name];
  }

  if (!deepEqual(reparsed.value, expected)) { return 'la estructura resultante no coincide con la esperada'; }
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
