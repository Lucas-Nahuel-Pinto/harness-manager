import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from './jsonc.ts';

/** Optional harness.json manifest — overrides/extends the conventional paths (spec §3). */
export interface HarnessManifest {
  skills?: string[]
  commands?: string[]
  agentDirs?: Array<{ dir: string, host: 'opencode' | 'claude' }>
  mcps?: string[]
  env?: { example?: string, file?: string }
  models?: {
    main?: { file: string, jsonPath: string }
    subagents?: { glob: string, field: string }
  }
}

export interface ManifestResult {
  manifest: HarnessManifest
  present: boolean
  error: string | null
}

export function loadManifest(root: string): ManifestResult {
  const file = join(root, 'harness.json');
  if (!existsSync(file)) { return { manifest: {}, present: false, error: null }; }

  const parsed = parseJsonc<HarnessManifest>(readFileSync(file, 'utf8'));
  if (!parsed.value) { return { manifest: {}, present: true, error: `harness.json: ${parsed.error}` }; }
  return { manifest: parsed.value, present: true, error: null };
}

export const CONVENTION = {
  skillDirs: ['.opencode/skills', '.claude/skills', '.agents/skills'],
  commandDirs: ['.claude/commands'],
  agentDirs: [
    { dir: '.opencode/agents', host: 'opencode' as const },
    { dir: '.claude/agents', host: 'claude' as const },
  ],
  mcpFiles: ['opencode.jsonc', '.mcp.json'],
  /** Claude Code's project settings — where disabledMcpjsonServers lives (spec 2026-10-13). */
  claudeSettings: '.claude/settings.json',
  claudeDisabledServers: 'disabledMcpjsonServers',
  envExample: '.env.example',
  envFile: '.env',
  registry: '.claude/skills/REGISTRY.md',
  kataManifest: 'kata-manifest.json',
};
