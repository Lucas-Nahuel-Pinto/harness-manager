import type { AgentEl, McpEl } from '../types.ts';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { asString, parseFrontmatter } from './frontmatter.ts';
import { parseJsonc } from './jsonc.ts';

function rel(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

export function scanAgents(
  root: string,
  agentDirs: Array<{ dir: string, host: 'opencode' | 'claude' }>,
  mainModel: { file: string, value: string | null },
  warnings: string[],
): AgentEl[] {
  const out: AgentEl[] = [];

  if (mainModel.value) {
    out.push({
      id: `agent:${mainModel.file}`,
      name: '(main session)',
      path: mainModel.file,
      host: 'opencode',
      model: mainModel.value,
      description: 'Main agent session model',
      mode: null,
      isMain: true,
    });
  }

  for (const { dir, host } of agentDirs) {
    const base = join(root, dir);
    let files: string[] = [];
    try {
      files = readdirSync(base, { withFileTypes: true })
        .filter(d => d.isFile() && d.name.endsWith('.md'))
        .map(d => d.name);
    }
    catch {
      continue;
    }

    for (const file of files) {
      const path = join(base, file);
      const fm = parseFrontmatter(readFileSync(path, 'utf8'));
      if (!fm.ok) { warnings.push(`agent with invalid frontmatter: ${rel(root, path)}`); }
      out.push({
        id: `agent:${rel(root, path)}`,
        name: asString(fm.data.name) ?? file.replace(/\.md$/, ''),
        path: rel(root, path),
        host,
        model: asString(fm.data.model),
        description: asString(fm.data.description) ?? '',
        mode: asString(fm.data.mode),
        isMain: false,
      });
    }
  }

  out.sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name));
  return out;
}

/** Main-session model from a JSONC config via dotted jsonPath (e.g. "model"). */
export function readMainModel(root: string, file: string, jsonPath: string, warnings: string[]): {
  file: string
  value: string | null
} {
  const path = join(root, file);
  if (!existsSync(path)) { return { file, value: null }; }

  const parsed = parseJsonc<Record<string, unknown>>(readFileSync(path, 'utf8'));
  if (!parsed.value) {
    warnings.push(`${file}: ${parsed.error}`);
    return { file, value: null };
  }
  let cursor: unknown = parsed.value;
  for (const key of jsonPath.split('.')) {
    if (cursor && typeof cursor === 'object') { cursor = (cursor as Record<string, unknown>)[key]; }
    else { return { file, value: null }; }
  }
  return { file, value: typeof cursor === 'string' ? cursor : null };
}

export function scanMcps(root: string, mcpFiles: string[], warnings: string[]): McpEl[] {
  const out: McpEl[] = [];

  for (const configFile of mcpFiles) {
    const path = join(root, configFile);
    if (!existsSync(path)) { continue; }

    const text = readFileSync(path, 'utf8');
    const parsed = parseJsonc<Record<string, unknown>>(text);
    if (!parsed.value) {
      warnings.push(`${configFile}: ${parsed.error}`);
      continue;
    }

    const container = (parsed.value.mcp ?? parsed.value.mcpServers) as Record<string, unknown> | undefined;
    if (!container || typeof container !== 'object') { continue; }

    for (const [name, def] of Object.entries(container)) {
      out.push({
        id: `mcp:${configFile}:${name}`,
        name,
        configFile,
        // opencode honors `enabled: false` in-place; anything else counts as enabled
        enabled: !def || typeof def !== 'object' || (def as { enabled?: unknown }).enabled !== false,
        envRefs: collectEnvRefs(def),
      });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name) || a.configFile.localeCompare(b.configFile));
  return out;
}

function collectEnvRefs(value: unknown, found = new Set<string>()): string[] {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/\{env:([A-Za-z_]\w*)\}|\$\{([A-Za-z_]\w*)\}/g)) { found.add(m[1] ?? m[2]); }
    return [...found];
  }
  if (Array.isArray(value)) {
    for (const item of value) { collectEnvRefs(item, found); }
  }
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) { collectEnvRefs(item, found); }
  }
  return [...found];
}
