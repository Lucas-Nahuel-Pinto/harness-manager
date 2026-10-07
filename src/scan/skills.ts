import type { CommandEl, SkillEl, SkillTier } from '../types.ts';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { asString, extractTriggers, parseFrontmatter } from './frontmatter.ts';

const UPSTREAM_MARKERS = ['LICENSE', 'LICENSE-APACHE', 'NOTICE'];

function rel(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  }
  catch {
    return '';
  }
}

function listDirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  }
  catch {
    return [];
  }
}

function listFiles(path: string, ext: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.endsWith(ext))
      .map(d => d.name);
  }
  catch {
    return [];
  }
}

function listFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile())
      .map(d => `references/${d.name}`);
  }
  catch {
    return [];
  }
}

function inferTier(skillDir: string, dirName: string, hasUpstreamMarker: boolean): SkillTier {
  if (dirName.includes('.agents/')) { return 'T3'; }
  if (hasUpstreamMarker) { return 'T2'; }
  return skillDir.includes('.claude') ? 'T1' : 'T3';
}

export function scanSkills(root: string, skillDirs: string[], warnings: string[]): SkillEl[] {
  const out: SkillEl[] = [];

  for (const dirName of skillDirs) {
    const base = join(root, dirName);
    for (const name of listDirs(base)) {
      const skillPath = join(base, name);
      const mdPath = join(skillPath, 'SKILL.md');
      if (!existsSync(mdPath)) {
        warnings.push(`skill dir without SKILL.md: ${rel(root, skillPath)}`);
        continue;
      }
      const raw = readText(mdPath);
      const fm = parseFrontmatter(raw);
      if (!fm.ok) { warnings.push(`skill with invalid frontmatter: ${rel(root, mdPath)}`); }

      const description = asString(fm.data.description) ?? '';
      const hasUpstream = UPSTREAM_MARKERS.some(m => existsSync(join(skillPath, m)))
        || /upstream|vendored from/i.test(description);

      const refs = listFilesIn(join(skillPath, 'references'));
      const scripts = listFiles(join(skillPath, 'scripts'), '.ts')
        .concat(listFiles(join(skillPath, 'scripts'), '.mjs'));

      out.push({
        id: `skill:${rel(root, mdPath)}`,
        name: asString(fm.data.name) ?? name,
        tier: inferTier(skillPath, dirName, hasUpstream),
        path: rel(root, mdPath),
        description,
        triggers: extractTriggers(description),
        refs,
        scripts,
        evals: existsSync(join(skillPath, 'evals')),
        vendored: hasUpstream,
        registered: false,
      });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function scanCommands(root: string, commandDirs: string[]): CommandEl[] {
  const out: CommandEl[] = [];

  for (const dirName of commandDirs) {
    const base = join(root, dirName);
    let names: string[] = [];
    try {
      names = readdirSync(base, { withFileTypes: true })
        .filter(d => d.isFile() && d.name.endsWith('.md'))
        .map(d => d.name);
    }
    catch {
      continue;
    }

    for (const file of names) {
      const path = join(base, file);
      const fm = parseFrontmatter(readText(path));
      const firstLine = fm.body.split(/\r?\n/).find(l => l.trim().length > 0)?.trim() ?? '';
      const description = asString(fm.data.description)
        ?? (firstLine.startsWith('#') ? firstLine.replace(/^#+\s*/, '') : firstLine);
      out.push({
        id: `command:${rel(root, path)}`,
        name: file.replace(/\.md$/, ''),
        path: rel(root, path),
        description,
      });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function registeredSkillNames(root: string, registryRel = '.claude/skills/REGISTRY.md'): {
  registered: Set<string>
  indexed: number | null
} {
  const path = join(root, registryRel);
  const registered = new Set<string>();
  if (!statSyncSafe(path)) { return { registered, indexed: null }; }

  const text = readText(path);
  for (const m of text.matchAll(/^## Skill: (\S+)$/gm)) { registered.add(m[1]); }
  const indexed = /Skills indexed: (\d+)/.exec(text)?.[1];
  return { registered, indexed: indexed ? Number(indexed) : null };
}

function statSyncSafe(path: string): boolean {
  try {
    statSync(path);
    return true;
  }
  catch {
    return false;
  }
}
