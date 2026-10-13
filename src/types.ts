/** Snapshot element types — mirror of harness.schema.json (keep in sync). */

export type SkillTier = 'T1' | 'T2' | 'T3' | 'T4';

export interface SkillEl {
  id: string
  name: string
  tier: SkillTier
  path: string
  description: string
  triggers: string[]
  refs: string[]
  scripts: string[]
  evals: boolean
  vendored: boolean
  registered: boolean
}

export interface CommandEl {
  id: string
  name: string
  path: string
  description: string
}

export interface AgentEl {
  id: string
  name: string
  path: string
  host: 'opencode' | 'claude'
  model: string | null
  description: string
  mode: string | null
  isMain: boolean
}

export interface McpEl {
  id: string
  name: string
  configFile: string
  enabled: boolean
  envRefs: string[]
}

export interface EnvVarEl {
  name: string
  inExample: boolean
  inEnv: boolean
}

export interface ScriptEl {
  id: string
  name: string
  command: string
}

export interface RegistryEl {
  id: string
  name: string
  path: string
  kind: 'skill-registry' | 'kata-manifest'
  entries: number
  stale: boolean | null
}

export interface HealthEl {
  docs: {
    agentsMd: boolean
    readme: boolean
  }
  ci: {
    workflows: string[]
    husky: boolean
  }
  tests: {
    testScript: boolean
    lintScript: boolean
    typesScript: boolean
  }
}

export interface CatalogModel {
  id: string
  name: string
  provider: string
}

export interface SnapshotMeta {
  root: string
  scannedAt: string
  toolVersion: string
  manifest: boolean
  warnings: string[]
}

export interface HarnessSnapshot {
  schemaVersion: 1
  meta: SnapshotMeta
  skills: SkillEl[]
  commands: CommandEl[]
  agents: AgentEl[]
  mcps: McpEl[]
  env: EnvVarEl[]
  scripts: ScriptEl[]
  registries: RegistryEl[]
  health: HealthEl
  catalog: { models: CatalogModel[] }
}
