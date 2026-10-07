import type { CatalogModel, EnvVarEl, HealthEl, RegistryEl, ScriptEl } from '../types.ts';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from './jsonc.ts';

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

export function scanCatalog(root: string, catalogFile: string, warnings: string[]): CatalogModel[] {
  const path = join(root, catalogFile);
  if (!existsSync(path)) { return []; }

  const parsed = parseJsonc<{ models?: unknown[] }>(readFileSync(path, 'utf8'));
  if (!parsed.value) {
    warnings.push(`${catalogFile}: ${parsed.error}`);
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

  const catalogPath = join(root, '.models.catalog.json');
  const catalogCount = countFile(catalogPath, (text) => {
    const parsed = parseJsonc<{ models?: unknown[] }>(text);
    return parsed.value && Array.isArray(parsed.value.models) ? parsed.value.models.length : 0;
  });
  if (catalogCount !== null) {
    out.push({
      id: 'registry:models-catalog',
      name: 'Models Catalog',
      path: '.models.catalog.json',
      kind: 'models-catalog',
      entries: catalogCount,
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
