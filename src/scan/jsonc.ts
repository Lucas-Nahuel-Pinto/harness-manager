/** Strip line (double-slash) and block comments from JSONC, preserving string literals. */
export function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (escaped) { escaped = false; }
      else if (ch === '\\') { escaped = true; }
      else if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

export interface JsoncResult<T> {
  value: T | null
  error: string | null
}

export function parseJsonc<T>(input: string): JsoncResult<T> {
  try {
    return { value: JSON.parse(stripJsonComments(input)) as T, error: null };
  }
  catch (e) {
    return { value: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Collect `{env:VAR}` / `${VAR}` style env references from any string. */
export function envRefsIn(value: unknown, found = new Set<string>()): string[] {
  if (typeof value === 'string') {
    for (const re of [/\{env:([A-Za-z_]\w*)\}/g, /\$\{([A-Z_]\w*)\}/gi]) {
      for (const m of value.matchAll(re)) { found.add(m[1]); }
    }
    return [...found];
  }
  if (Array.isArray(value)) {
    for (const item of value) { envRefsIn(item, found); }
  }
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) { envRefsIn(item, found); }
  }
  return [...found];
}
