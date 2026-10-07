import type { SkillTier } from './types.ts';

export type TabId = 'resumen' | 'skills' | 'agents' | 'mcp-env' | 'scripts' | 'graph';

export type EnvStatus = 'all' | 'both' | 'example-only' | 'env-only' | 'missing';

export type GraphKind = 'skill' | 'command' | 'agent' | 'mcp' | 'script' | 'env' | 'ref' | 'registry';

export const ALL_GRAPH_KINDS: GraphKind[] = ['skill', 'command', 'agent', 'mcp', 'script', 'env', 'ref', 'registry'];

export interface Filters {
  tiers: SkillTier[]
  registeredOnly: boolean
  vendoredOnly: boolean
  hosts: string[]
  mcpConfigFiles: string[]
  envStatus: EnvStatus
  graphKinds: GraphKind[]
}

export interface AppState {
  tab: TabId
  search: string
  selectedId: string | null
  showWarnings: boolean
  filtersCollapsed: boolean
  detailCollapsed: boolean
  filters: Filters
}

const state: AppState = {
  tab: 'resumen',
  search: '',
  selectedId: null,
  showWarnings: false,
  filtersCollapsed: false,
  detailCollapsed: false,
  filters: { tiers: [], registeredOnly: false, vendoredOnly: false, hosts: [], mcpConfigFiles: [], envStatus: 'all', graphKinds: [...ALL_GRAPH_KINDS] },
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function subscribe(listener: () => void): void {
  listeners.add(listener);
}

export function notify(): void {
  for (const listener of listeners) { listener(); }
}

export function setTab(tab: TabId): void {
  state.tab = tab;
  notify();
}

export function setSearch(search: string): void {
  state.search = search;
  notify();
}

export function select(selectedId: string | null): void {
  state.selectedId = selectedId;
  state.showWarnings = false;
  notify();
}

export function toggleWarnings(): void {
  state.showWarnings = !state.showWarnings;
  state.selectedId = null;
  notify();
}

export function setFiltersCollapsed(filtersCollapsed: boolean): void {
  state.filtersCollapsed = filtersCollapsed;
  notify();
}

export function setDetailCollapsed(detailCollapsed: boolean): void {
  state.detailCollapsed = detailCollapsed;
  notify();
}

function toggleValue(list: string[], value: string): void {
  const index = list.indexOf(value);
  if (index === -1) { list.push(value); }
  else { list.splice(index, 1); }
}

export function toggleTier(tier: SkillTier): void {
  toggleValue(state.filters.tiers, tier);
  notify();
}

export function toggleHost(host: string): void {
  toggleValue(state.filters.hosts, host);
  notify();
}

export function toggleMcpConfig(configFile: string): void {
  toggleValue(state.filters.mcpConfigFiles, configFile);
  notify();
}

export function toggleFlag(flag: 'registeredOnly' | 'vendoredOnly'): void {
  state.filters[flag] = !state.filters[flag];
  notify();
}

export function setEnvStatus(envStatus: EnvStatus): void {
  state.filters.envStatus = envStatus;
  notify();
}

export function toggleGraphKind(kind: GraphKind): void {
  toggleValue(state.filters.graphKinds, kind);
  notify();
}

/** Used once at graph-module init (perf guard) before the first render. */
export function setGraphKinds(graphKinds: GraphKind[]): void {
  state.filters.graphKinds = graphKinds;
  notify();
}
