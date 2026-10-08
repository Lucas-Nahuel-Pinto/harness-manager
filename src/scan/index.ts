import type { AgentEl, HarnessSnapshot } from '../types.ts';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { readMainModel, scanAgents, scanMcps } from './agents.ts';
import { CONVENTION, loadManifest } from './manifest.ts';
import { scanCatalog, scanEnv, scanHealth, scanRegistries, scanScripts } from './misc.ts';
import { registeredSkillNames, scanCommands, scanSkills } from './skills.ts';

export const TOOL_VERSION = '0.1.0';

export interface ScanResult {
  snapshot: HarnessSnapshot | null
  error: string | null
}

/** Orchestrate a full harness scan. Never throws — errors come back structured (plan Phase 2). */
export function scanHarness(rootInput: string): ScanResult {
  const root = isAbsolute(rootInput) ? rootInput : resolve(rootInput);

  if (!existsSync(root)) { return { snapshot: null, error: `harness root does not exist: ${root}` }; }

  const warnings: string[] = [];
  const { manifest, present, error: manifestError } = loadManifest(root);
  if (manifestError) { warnings.push(manifestError); }

  try {
    const skillDirs = manifest.skills ?? CONVENTION.skillDirs;
    const commandDirs = manifest.commands ?? CONVENTION.commandDirs;
    const agentDirs = manifest.agentDirs ?? CONVENTION.agentDirs;
    const mcpFiles = manifest.mcps ?? CONVENTION.mcpFiles;
    const envExample = manifest.env?.example ?? CONVENTION.envExample;
    const envFile = manifest.env?.file ?? CONVENTION.envFile;
    const catalogFile = manifest.models?.catalog ?? CONVENTION.modelCatalog;
    const mainCfg = manifest.models?.main ?? { file: 'opencode.jsonc', jsonPath: 'model' };

    const skills = scanSkills(root, skillDirs, warnings);
    const { registered } = registeredSkillNames(root);
    for (const skill of skills) { skill.registered = registered.has(skill.name); }

    const commands = scanCommands(root, commandDirs);
    const mainModel = readMainModel(root, mainCfg.file, mainCfg.jsonPath, warnings);
    const agents: AgentEl[] = scanAgents(root, agentDirs, mainModel, warnings);
    const mcps = scanMcps(root, mcpFiles, warnings);
    const env = scanEnv(root, envExample, envFile);
    const scripts = scanScripts(root, warnings);
    const registries = scanRegistries(root, skills.length, warnings);
    const health = scanHealth(root);
    const catalog = scanCatalog(root, catalogFile, warnings);

    const total = skills.length + commands.length + agents.length + mcps.length
      + env.length + scripts.length;
    if (total === 0) { return { snapshot: null, error: `empty scan: no harness elements found under ${root}` }; }

    return {
      snapshot: {
        schemaVersion: 1,
        meta: {
          root,
          scannedAt: new Date().toISOString(),
          toolVersion: TOOL_VERSION,
          manifest: present,
          warnings,
        },
        skills,
        commands,
        agents,
        mcps,
        env,
        scripts,
        registries,
        health,
        catalog: { models: catalog },
      },
      error: null,
    };
  }
  catch (e) {
    return { snapshot: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export function snapshotPath(repoRoot: string): string {
  return join(repoRoot, 'data', 'harness.json');
}
