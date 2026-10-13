import type { CatalogModel, EnvVarEl, HealthEl, RegistryEl, ScriptEl } from '../types.ts';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DEFAULT_TTL_MS, isStale, readCatalog, writeCatalogAtomic } from '../catalog/cache.ts';
import { fetchModels } from '../catalog/fetch.ts';
import { parseJsonc } from './jsonc.ts';

/** Refresh budget (spec §3.6): hard 15s cap on the whole fetch, then degrade to a warning. */
const REFRESH_BUDGET_MS = 15_000;

/** MODELS_CACHE_TTL is seconds (boilerplate parity). Absent/invalid → 24h default. */
function catalogTtlMs(): number {
  const raw = process.env.MODELS_CACHE_TTL;
  if (!raw) { return DEFAULT_TTL_MS; }
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_TTL_MS;
}

/**
 * Native catalog refresh on the rescan path (spec §3.5–3.8, shared-store revision
 * 2026-10-13): runs for EVERY harness when the engine-owned store is missing or
 * stale — there is no interest gate and the harness root is never written to.
 * Awaits the fetch before the scan reads the store (no read/write race), keeps
 * the old store on total failure. Returns a warning string for the snapshot, or
 * null when nothing needed doing. Never throws.
 */
export async function refreshModelCatalog(
  storePath: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const cached = readCatalog(storePath);
  if (cached && !isStale(cached, catalogTtlMs())) { return null; }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fetched = await Promise.race([
      fetchModels({ fetchImpl: opts.fetchImpl }),
      new Promise<null>((resolve) => { timer = setTimeout(() => { resolve(null); }, REFRESH_BUDGET_MS); }),
    ]);
    if (!fetched) { return 'model catalog refresh timed out (15s)'; }
    if (fetched.models.length === 0 && fetched.sources.length === 0) {
      return 'model catalog refresh failed (all sources)';
    }
    writeCatalogAtomic(storePath, fetched);
    return null;
  }
  catch (e) {
    return `model catalog refresh error: ${e instanceof Error ? e.message : String(e)}`;
  }
  finally {
    if (timer !== undefined) { clearTimeout(timer); }
  }
}

function envKeys(path: string): Set<string> {
  const keys = new Set<string>();
  if (!existsSync(path)) { return keys; }
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/.exec(line);
    if (m) { keys.add(m[1]); }
  }
  return keys;
}

/** Presence-only env scan: variable NAMES cross-referenced, values never read into the snapshot. */
export function scanEnv(root: string, exampleFile: string, envFile: string): EnvVarEl[] {
  const example = envKeys(join(root, exampleFile));
  const real = envKeys(join(root, envFile));
  const all = [...new Set([...example, ...real])].sort();
  return all.map(name => ({ name, inExample: example.has(name), inEnv: real.has(name) }));
}

export function scanScripts(root: string, warnings: string[]): ScriptEl[] {
  const path = join(root, 'package.json');
  if (!existsSync(path)) { return []; }

  const parsed = parseJsonc<{ scripts?: Record<string, string> }>(readFileSync(path, 'utf8'));
  if (!parsed.value) {
    warnings.push(`package.json: ${parsed.error}`);
    return [];
  }
  const scripts = parsed.value.scripts ?? {};
  return Object.entries(scripts)
    .map(([name, command]) => ({ id: `script:${name}`, name, command }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Read the shared engine-owned catalog store. Missing file, invalid JSON, or wrong shape → []. */
export function scanCatalog(storePath: string, warnings: string[]): CatalogModel[] {
  if (!existsSync(storePath)) { return []; }

  const parsed = parseJsonc<{ models?: unknown[] }>(readFileSync(storePath, 'utf8'));
  if (!parsed.value) {
    warnings.push(`${basename(storePath)}: ${parsed.error}`);
    return [];
  }
  const models = Array.isArray(parsed.value.models) ? parsed.value.models : [];
  return models
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map(m => ({
      id: typeof m.id === 'string' ? m.id : '',
      name: typeof m.name === 'string' ? m.name : '',
      provider: typeof m.provider === 'string' ? m.provider : '',
    }))
    .filter(m => m.id);
}

function countFile(path: string, fallback: (text: string) => number): number | null {
  if (!existsSync(path)) { return null; }
  return fallback(readFileSync(path, 'utf8'));
}

export function scanRegistries(root: string, skillCount: number, warnings: string[]): RegistryEl[] {
  const out: RegistryEl[] = [];

  const registryPath = join(root, '.claude/skills/REGISTRY.md');
  const indexed = countFile(registryPath, (text) => {
    const m = /Skills indexed: (\d+)/.exec(text);
    return m ? Number(m[1]) : [...text.matchAll(/^## Skill: /gm)].length;
  });
  if (indexed !== null) {
    out.push({
      id: 'registry:skill-registry',
      name: 'Skill Registry',
      path: '.claude/skills/REGISTRY.md',
      kind: 'skill-registry',
      entries: indexed,
      stale: indexed !== skillCount,
    });
  }

  const kataPath = join(root, 'kata-manifest.json');
  const kata = countFile(kataPath, (text) => {
    const parsed = parseJsonc<{ components?: Record<string, unknown[]> }>(text);
    if (!parsed.value) {
      warnings.push(`kata-manifest.json: ${parsed.error}`);
      return 0;
    }
    let total = 0;
    for (const group of Object.values(parsed.value.components ?? {})) {
      if (Array.isArray(group)) {
        for (const comp of group) {
          const atcs = (comp as { atcs?: unknown[] })?.atcs;
          total += Array.isArray(atcs) ? atcs.length : 0;
        }
      }
    }
    return total;
  });
  if (kata !== null) {
    out.push({
      id: 'registry:kata-manifest',
      name: 'KATA Manifest',
      path: 'kata-manifest.json',
      kind: 'kata-manifest',
      entries: kata,
      stale: null,
    });
  }

  return out;
}

function exists(path: string): boolean {
  return existsSync(path);
}

export function scanHealth(root: string): HealthEl {
  const pkg = (() => {
    const path = join(root, 'package.json');
    if (!existsSync(path)) { return {} as Record<string, string>; }
    const parsed = parseJsonc<{ scripts?: Record<string, string> }>(readFileSync(path, 'utf8'));
    return parsed.value?.scripts ?? {};
  })();

  let workflows: string[] = [];
  try {
    workflows = readdirSync(join(root, '.github', 'workflows'))
      .filter((f: string) => f.endsWith('.yml') || f.endsWith('.yaml'));
  }
  catch {
    workflows = [];
  }

  return {
    docs: {
      agentsMd: exists(join(root, 'AGENTS.md')) || exists(join(root, 'CLAUDE.md')),
      readme: exists(join(root, 'README.md')),
    },
    ci: {
      workflows,
      husky: exists(join(root, '.husky')),
    },
    tests: {
      testScript: 'test' in pkg,
      lintScript: 'lint' in pkg || 'lint:check' in pkg,
      typesScript: 'types:check' in pkg || 'typecheck' in pkg,
    },
  };
}
