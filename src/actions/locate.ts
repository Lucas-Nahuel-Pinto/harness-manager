/**
 * Minimal JSONC locator: finds key/value byte offsets for a dotted path.
 * String- and comment-aware (a `}` inside `"Bearer {env:VAR}"` never confuses it).
 */

export interface KeyLoc {
  /** offset of the opening `"` of the key */
  keyStart: number
  /** offset just after the closing `"` of the key */
  keyEnd: number
  /** offset of the first byte of the value */
  valueStart: number
  /** offset just after the last byte of the value */
  valueEnd: number
}

interface ScanState {
  text: string
  target: string[]
  found: KeyLoc | null
}

/** Skip whitespace + `//` / `/* *\/` comments. Exported for the JSONC line-edit strategies. */
export function skipTrivia(text: string, index: number): number {
  let i = index;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') { i++; }
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function readString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '"') { return i + 1; }
    i++;
  }
  return -1;
}

/** Scalars are strings / numbers / true / false / null — never contain unquoted `},]`. */
function skipScalar(text: string, start: number): number {
  if (text[start] === '"') { return readString(text, start); }
  let i = start;
  while (i < text.length && !',}\]'.includes(text[i]) && text[i] !== '\n') {
    if (text[i] === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) { break; }
    i++;
  }
  return i;
}

function scanValue(state: ScanState, start: number, path: string[], depth: number): number {
  const ch = state.text[start];
  if (ch === '{') { return scanObject(state, start, path, depth); }
  if (ch === '[') { return scanArray(state, start, path, depth); }
  return skipScalar(state.text, start);
}

function matchesTarget(path: string[], target: string[]): boolean {
  return path.length === target.length && path.every((seg, idx) => seg === target[idx]);
}

function scanObject(state: ScanState, start: number, path: string[], depth: number): number {
  const { text } = state;
  if (depth > 64) { return -1; }
  let i = start + 1;
  for (;;) {
    i = skipTrivia(text, i);
    if (i >= text.length) { return -1; }
    if (text[i] === '}') { return i + 1; }
    if (text[i] === ',') { i++; continue; }
    if (text[i] !== '"') { return -1; }

    const keyStart = i;
    const keyEnd = readString(text, i);
    if (keyEnd === -1) { return -1; }
    const key = text.slice(keyStart + 1, keyEnd - 1);
    const colon = skipTrivia(text, keyEnd);
    if (colon >= text.length || text[colon] !== ':') { return -1; }

    const childPath = [...path, key];
    const valueStart = skipTrivia(text, colon + 1);
    if (valueStart >= text.length) { return -1; }

    const valueEnd = scanValue(state, valueStart, childPath, depth + 1);
    if (valueEnd === -1) { return -1; }
    if (matchesTarget(childPath, state.target)) {
      state.found = { keyStart, keyEnd, valueStart, valueEnd };
      return valueEnd;
    }
    i = valueEnd;
  }
}

function scanArray(state: ScanState, start: number, path: string[], depth: number): number {
  const { text } = state;
  if (depth > 64) { return -1; }
  let i = start + 1;
  for (;;) {
    i = skipTrivia(text, i);
    if (i >= text.length) { return -1; }
    if (text[i] === ']') { return i + 1; }
    if (text[i] === ',') { i++; continue; }
    const valueEnd = scanValue(state, i, path, depth + 1);
    if (valueEnd === -1) { return -1; }
    i = valueEnd;
  }
}

/** Locate `["mcp", "tavily"]` etc. Returns null when the path is absent or the text is malformed. */
export function locatePath(text: string, path: string[]): KeyLoc | null {
  const state: ScanState = { text, target: path, found: null };
  const start = skipTrivia(text, 0);
  if (start >= text.length) { return null; }
  scanValue(state, start, [], 0);
  return state.found;
}
