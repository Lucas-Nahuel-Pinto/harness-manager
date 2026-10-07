import { parse } from 'yaml';

export interface Frontmatter {
  data: Record<string, unknown>
  body: string
  ok: boolean
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Tolerant frontmatter parser: malformed YAML yields ok:false with empty data, never throws. */
export function parseFrontmatter(raw: string): Frontmatter {
  const match = FM_RE.exec(raw);
  if (!match) { return { data: {}, body: raw, ok: false }; }

  try {
    const data = parse(match[1]) as unknown;
    if (data && typeof data === 'object' && !Array.isArray(data)) { return { data: data as Record<string, unknown>, body: match[2], ok: true }; }
    return { data: lenientKeys(match[1]), body: match[2], ok: false };
  }
  catch {
    return { data: lenientKeys(match[1]), body: match[2], ok: false };
  }
}

/**
 * Best-effort extraction of scalar name/description when the block is not valid YAML.
 * The QA boilerplate itself ships skills whose frontmatter fails strict parsing
 * (its own registry script silently falls back to {}); we keep a warning but
 * still surface usable data in the dashboard.
 */
function lenientKeys(text: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const name = /^name:\s*(\S[^\r\n]*)$/m.exec(text);
  if (name && !/[[{]/.test(name[1])) { data.name = name[1].replace(/^["']|["']$/g, ''); }
  const desc = /^description:[ \t]*(\S.*)$/m.exec(text);
  if (desc) { data.description = desc[1].trim().replace(/^["']|["']$/g, ''); }
  return data;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) { return value.filter((v): v is string => typeof v === 'string'); }
  if (typeof value === 'string') { return value.split(',').map(s => s.trim()).filter(Boolean); }
  return [];
}

/** Best-effort "Triggers on:" extraction from a skill description. */
export function extractTriggers(description: string): string[] {
  const marker = description.search(/triggers? on:/i);
  if (marker === -1) { return []; }
  const rest = description.slice(marker).replace(/triggers? on:/i, '');
  const stop = rest.search(/\bdo not use\b/i);
  const segment = stop === -1 ? rest : rest.slice(0, stop);
  return segment
    .split(/,|\bor\b/)
    .map(s => s.replace(/^[\s:]+|[\s.]+$/g, ''))
    .filter(s => s.length > 2)
    .slice(0, 20);
}
