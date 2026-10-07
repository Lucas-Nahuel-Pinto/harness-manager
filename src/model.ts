import type { AppState, GraphKind } from './state.ts';
import type { AgentEl, CommandEl, EnvVarEl, McpEl, RegistryEl, ScriptEl, SkillEl } from './types.ts';
import { snapshot } from './data.ts';

export const meta = snapshot.meta;
export const skills: SkillEl[] = snapshot.skills;
export const commands: CommandEl[] = snapshot.commands;
export const agents: AgentEl[] = snapshot.agents;
export const mcps: McpEl[] = snapshot.mcps;
export const env: EnvVarEl[] = snapshot.env;
export const scripts: ScriptEl[] = snapshot.scripts;
export const registries: RegistryEl[] = snapshot.registries;
export const health = snapshot.health;
export const catalogModels = snapshot.catalog.models;

export const totals = {
  skills: skills.length,
  commands: commands.length,
  agents: agents.length,
  mcps: mcps.length,
  env: env.length,
  scripts: scripts.length,
  registries: registries.length,
};

export const warningCount = meta.warnings.length;
export const staleRegistries = registries.filter(registry => registry.stale === true);

export const healthRollup = {
  docs: health.docs.agentsMd && health.docs.readme,
  ci: health.ci.workflows.length > 0 && health.ci.husky,
  tests: health.tests.testScript && health.tests.lintScript && health.tests.typesScript,
};

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export const mcpConfigFiles = uniqueSorted(mcps.map(mcp => mcp.configFile));
export const agentHosts = uniqueSorted(agents.map(agent => agent.host));
export const modelNames = uniqueSorted(catalogModels.map(model => model.name));

function contains(query: string, ...fields: (string | null | undefined)[]): boolean {
  if (!query) { return true; }
  const needle = query.toLowerCase();
  return fields.some(field => (field ?? '').toLowerCase().includes(needle));
}

export function skillMatches(skill: SkillEl, state: AppState): boolean {
  const { filters, search } = state;
  if (filters.tiers.length > 0 && !filters.tiers.includes(skill.tier)) { return false; }
  if (filters.registeredOnly && !skill.registered) { return false; }
  if (filters.vendoredOnly && !skill.vendored) { return false; }
  return contains(search, skill.name, skill.description, skill.path);
}

export function commandMatches(command: CommandEl, state: AppState): boolean {
  return contains(state.search, command.name, command.description, command.path);
}

export function agentMatches(agent: AgentEl, state: AppState): boolean {
  const { filters, search } = state;
  if (filters.hosts.length > 0 && !filters.hosts.includes(agent.host)) { return false; }
  return contains(search, agent.name, agent.description, agent.path, agent.model);
}

export function mcpMatches(mcp: McpEl, state: AppState): boolean {
  const { filters, search } = state;
  if (filters.mcpConfigFiles.length > 0 && !filters.mcpConfigFiles.includes(mcp.configFile)) { return false; }
  return contains(search, mcp.name, mcp.configFile, mcp.envRefs.join(' '));
}

export function envMatches(envVar: EnvVarEl, state: AppState): boolean {
  const status = state.filters.envStatus;
  if (status === 'both' && !(envVar.inExample && envVar.inEnv)) { return false; }
  if (status === 'example-only' && !(envVar.inExample && !envVar.inEnv)) { return false; }
  if (status === 'env-only' && !(envVar.inEnv && !envVar.inExample)) { return false; }
  if (status === 'missing' && (envVar.inExample || envVar.inEnv)) { return false; }
  return contains(state.search, envVar.name);
}

export function scriptMatches(script: ScriptEl, state: AppState): boolean {
  return contains(state.search, script.name, script.command);
}

export function registryMatches(registry: RegistryEl, state: AppState): boolean {
  return contains(state.search, registry.name, registry.path, registry.kind);
}

export type ElementKind = 'skill' | 'command' | 'agent' | 'mcp' | 'env' | 'script' | 'registry';

/** One hex per graph node kind (graph.ts stylesheet + legend). */
export const kindColor: Record<GraphKind, string> = {
  skill: '#4f8cff',
  command: '#d29922',
  agent: '#bc8cff',
  mcp: '#3fb950',
  script: '#76e3ea',
  env: '#ff7b72',
  ref: '#6e7681',
  registry: '#f778ba',
};

export const graphKindLabels: Record<GraphKind, string> = {
  skill: 'Skill',
  command: 'Comando',
  agent: 'Agente',
  mcp: 'MCP',
  script: 'Script',
  env: 'Env',
  ref: 'Refs',
  registry: 'Registro',
};

export type ElementRef
  = | { kind: 'skill', element: SkillEl }
    | { kind: 'command', element: CommandEl }
    | { kind: 'agent', element: AgentEl }
    | { kind: 'mcp', element: McpEl }
    | { kind: 'env', element: EnvVarEl }
    | { kind: 'script', element: ScriptEl }
    | { kind: 'registry', element: RegistryEl };

export function envId(name: string): string {
  return `env:${name}`;
}

const elementIndex = new Map<string, ElementRef>();
for (const skill of skills) { elementIndex.set(skill.id, { kind: 'skill', element: skill }); }
for (const command of commands) { elementIndex.set(command.id, { kind: 'command', element: command }); }
for (const agent of agents) { elementIndex.set(agent.id, { kind: 'agent', element: agent }); }
for (const mcp of mcps) { elementIndex.set(mcp.id, { kind: 'mcp', element: mcp }); }
for (const envVar of env) { elementIndex.set(envId(envVar.name), { kind: 'env', element: envVar }); }
for (const script of scripts) { elementIndex.set(script.id, { kind: 'script', element: script }); }
for (const registry of registries) { elementIndex.set(registry.id, { kind: 'registry', element: registry }); }

export function resolveElement(selectedId: string | null): ElementRef | null {
  if (!selectedId) { return null; }
  return elementIndex.get(selectedId) ?? null;
}
