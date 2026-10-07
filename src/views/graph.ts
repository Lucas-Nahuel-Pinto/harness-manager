import type { GraphKind } from '../state.ts';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { escapeHtml } from '../html.ts';
import { agents, commands, graphKindLabels, kindColor, mcps, meta, registries, scripts, skills } from '../model.ts';
import { ALL_GRAPH_KINDS, getState, notify, select, setGraphKinds } from '../state.ts';

cytoscape.use(fcose);

interface Position {
  x: number
  y: number
}

interface GraphNode {
  id: string
  kind: GraphKind
  label: string
  text: string
  /** Aux node → element whose detail sheet it belongs to (ref → skill). */
  ownerId: string | null
}

interface GraphHook {
  /** Visible node count of the last update — smoke-test hook, kept intentionally tiny. */
  nodes: number
  /** First visible node id + canvas-relative position (drives synthetic click tests). */
  first: () => { id: string, x: number, y: number } | null
}

declare global {
  interface Window {
    __hmGraph?: GraphHook
  }
}

const graphNodes: GraphNode[] = [];
const nodeById = new Map<string, GraphNode>();
const graphEdges: { from: string, to: string }[] = [];
const edgeKeys = new Set<string>();

function addNode(node: GraphNode): void {
  if (nodeById.has(node.id)) { return; }
  nodeById.set(node.id, node);
  graphNodes.push(node);
}

function addEdge(from: string, to: string): void {
  const key = `${from}|${to}`;
  if (edgeKeys.has(key)) { return; }
  edgeKeys.add(key);
  graphEdges.push({ from, to });
}

function buildGraph(): void {
  graphNodes.length = 0;
  nodeById.clear();
  graphEdges.length = 0;
  edgeKeys.clear();
  for (const skill of skills) {
    addNode({ id: skill.id, kind: 'skill', label: skill.name, text: `${skill.name} ${skill.path} ${skill.description}`, ownerId: null });
  }
  for (const command of commands) {
    addNode({ id: command.id, kind: 'command', label: command.name, text: `${command.name} ${command.path} ${command.description}`, ownerId: null });
  }
  for (const agent of agents) {
    addNode({ id: agent.id, kind: 'agent', label: agent.name, text: `${agent.name} ${agent.path} ${agent.description} ${agent.model ?? ''}`, ownerId: null });
  }
  for (const mcp of mcps) {
    addNode({ id: mcp.id, kind: 'mcp', label: mcp.name, text: `${mcp.name} ${mcp.configFile} ${mcp.envRefs.join(' ')}`, ownerId: null });
  }
  for (const script of scripts) {
    addNode({ id: script.id, kind: 'script', label: script.name, text: `${script.name} ${script.command}`, ownerId: null });
  }

  const skillRegistry = registries.find(registry => registry.kind === 'skill-registry');
  if (skillRegistry) {
    addNode({ id: 'registry:skill-registry', kind: 'registry', label: skillRegistry.name, text: `${skillRegistry.name} ${skillRegistry.path}`, ownerId: null });
  }

  for (const skill of skills) {
    const dir = skill.path.replace(/\/SKILL\.md$/, '');
    for (const ref of skill.refs) {
      const id = `ref:${dir}/${ref}`;
      addNode({ id, kind: 'ref', label: ref.split('/').pop() ?? ref, text: `${ref} ${skill.name}`, ownerId: skill.id });
      addEdge(skill.id, id);
    }
    if (skill.registered && skillRegistry) { addEdge(skill.id, 'registry:skill-registry'); }
  }

  const envReferenced = new Set(mcps.flatMap(mcp => mcp.envRefs));
  for (const name of envReferenced) {
    addNode({ id: `env:${name}`, kind: 'env', label: name, text: name, ownerId: null });
  }
  for (const mcp of mcps) {
    for (const name of mcp.envRefs) { addEdge(mcp.id, `env:${name}`); }
  }

  // Asociación blanda: comando y skill que comparten nombre (no hay vínculo duro en el harness)
  const skillsByName = new Map<string, string[]>();
  for (const skill of skills) {
    const ids = skillsByName.get(skill.name) ?? [];
    ids.push(skill.id);
    skillsByName.set(skill.name, ids);
  }
  for (const command of commands) {
    for (const skillId of skillsByName.get(command.name) ?? []) { addEdge(command.id, skillId); }
  }
}

buildGraph();

// Guard de rendimiento: >1500 nodos → los auxiliares 'ref' arrancan ocultos
if (graphNodes.length > 1500) {
  setGraphKinds(getState().filters.graphKinds.filter(kind => kind !== 'ref'));
}

const neighbors = new Map<string, Set<string>>();

function buildNeighbors(): void {
  neighbors.clear();
  for (const { from, to } of graphEdges) {
    if (!neighbors.has(from)) { neighbors.set(from, new Set()); }
    if (!neighbors.has(to)) { neighbors.set(to, new Set()); }
    neighbors.get(from)!.add(to);
    neighbors.get(to)!.add(from);
  }
}

buildNeighbors();

let instance: cytoscape.Core | null = null;
let buildSig = '';

/** Serve-mode rescan: rebuild node/edge/neighborhood caches from the refreshed model. */
export function rebuildGraph(): void {
  buildGraph();
  buildNeighbors();
  buildSig = '';
}
let building = false;
const posCache = new Map<string, Map<string, Position>>();

const graphHook: GraphHook = {
  nodes: 0,
  first: () => {
    if (!instance) { return null; }
    // la typificación de cytoscape devuelve aquí EdgeSingular | NodeSingular
    const node = instance.nodes().not('.hidden').first() as cytoscape.NodeSingular;
    if (node.empty()) { return null; }
    const pos = node.renderedPosition();
    return { id: node.id(), x: pos.x, y: pos.y };
  },
};
window.__hmGraph = graphHook;

function filtersSignature(): string {
  const { search, filters } = getState();
  return JSON.stringify({ kinds: [...filters.graphKinds].sort(), search, at: meta.scannedAt });
}

/**
 * Scope = nodos que matchean (tipo activo + búsqueda) ∪ sus vecinos por aristas
 * entrantes y salientes (contexto de ancestros y dependientes), pero solo si el
 * tipo del vecino está activo — así el toggle de tipo manda sobre el contexto
 * y el colapso de 'ref' (>1500 nodos) realmente oculta los auxiliares.
 */
function filterScope(): { scope: Set<string>, matches: Set<string> } {
  const { search, filters } = getState();
  const kinds = new Set<GraphKind>(filters.graphKinds);
  const needle = search.trim().toLowerCase();
  const matches = new Set<string>();
  for (const node of graphNodes) {
    if (!kinds.has(node.kind)) { continue; }
    if (needle && !node.text.toLowerCase().includes(needle)) { continue; }
    matches.add(node.id);
  }
  const scope = new Set(matches);
  for (const id of matches) {
    for (const neighbor of neighbors.get(id) ?? []) {
      const node = nodeById.get(neighbor);
      if (node && kinds.has(node.kind)) { scope.add(neighbor); }
    }
  }
  return { scope, matches };
}

function updateInstance(cy: cytoscape.Core): void {
  const { search, selectedId } = getState();
  const needle = search.trim().toLowerCase();
  const { scope, matches } = filterScope();
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const id = node.id();
      const visible = scope.has(id);
      const isMatch = visible && matches.has(id);
      node.toggleClass('hidden', !visible);
      node.toggleClass('match', Boolean(needle) && isMatch);
      node.toggleClass('dim', Boolean(needle) && visible && !isMatch);
      node.toggleClass('picked', id === selectedId);
    });

    cy.elements().removeClass('lit lit-edge faded');
    if (selectedId) {
      const selected = cy.getElementById(selectedId);
      if (selected.nonempty() && !selected.hasClass('hidden')) {
        const hood = selected.closedNeighborhood();
        hood.nodes().addClass('lit');
        hood.edges().addClass('lit-edge');
        cy.elements().not(hood).addClass('faded');
      }
    }
  });
  graphHook.nodes = cy.nodes().not('.hidden').length;
}

function legendHtml(): string {
  const items = ALL_GRAPH_KINDS.map(kind =>
    `<span class="item"><span class="dot" style="background:${kindColor[kind]}"></span>${escapeHtml(graphKindLabels[kind])}</span>`).join('');
  return `<div class="graph-legend">${items}</div>`;
}

const GRAPH_STYLE: cytoscape.StylesheetJsonBlock[] = [
  {
    selector: 'node',
    style: {
      'label': 'data(label)',
      'font-size': 8,
      'color': '#dbe2ee',
      'text-outline-color': '#0f1218',
      'text-outline-width': 1,
      'width': 13,
      'height': 13,
    },
  },
  { selector: 'node[kind = "skill"]', style: { 'width': 20, 'height': 20, 'font-size': 10, 'font-weight': 'bold' } },
  { selector: 'node[kind = "registry"]', style: { 'width': 24, 'height': 24, 'font-size': 10 } },
  { selector: 'node[kind = "env"]', style: { 'width': 10, 'height': 10, 'font-size': 7.5 } },
  { selector: 'node[kind = "ref"]', style: { 'width': 7, 'height': 7, 'font-size': 7, 'color': '#8b94a7' } },
  ...Object.entries(kindColor).map(([kind, color]) => ({
    selector: `node[kind = "${kind}"]`,
    style: { 'background-color': color },
  })) as cytoscape.StylesheetJsonBlock[],
  {
    selector: 'edge',
    style: {
      'width': 1,
      'line-color': '#39415a',
      'target-arrow-color': '#39415a',
      'target-arrow-shape': 'triangle',
      'opacity': 0.65,
      'curve-style': 'bezier',
    },
  },
  { selector: '.hidden', style: { display: 'none' } },
  { selector: '.dim', style: { opacity: 0.1 } },
  { selector: '.faded', style: { opacity: 0.07 } },
  {
    selector: 'node.lit',
    style: { 'border-width': 1.5, 'border-color': '#9ecbff', 'opacity': 1 },
  },
  {
    selector: 'edge.lit-edge',
    style: { 'line-color': '#9ecbff', 'target-arrow-color': '#9ecbff', 'width': 2.5, 'opacity': 1 },
  },
  { selector: 'node.match', style: { 'border-width': 3, 'border-color': '#f85149' } },
  {
    selector: 'node.picked',
    style: {
      'border-width': 3,
      'border-color': '#4f8cff',
      'overlay-color': '#4f8cff',
      'overlay-padding': 8,
      'overlay-opacity': 0.6,
    },
  },
];

function wireEvents(cy: cytoscape.Core): void {
  cy.on('tap', 'node', (event) => {
    const id = (event.target as cytoscape.NodeSingular).id();
    select(nodeById.get(id)?.ownerId ?? id);
  });
  cy.on('tap', (event) => {
    if (event.target === cy) { select(null); }
  });
}

function cachePositions(cy: cytoscape.Core, sig: string): void {
  const positions = new Map<string, Position>();
  cy.nodes().forEach((node) => {
    const pos = node.position();
    positions.set(node.id(), { x: pos.x, y: pos.y });
  });
  posCache.set(sig, positions);
}

function buildElements(cached: Map<string, Position> | undefined): cytoscape.ElementDefinition[] {
  const { scope } = filterScope();
  const elements: cytoscape.ElementDefinition[] = [];
  for (const node of graphNodes) {
    if (!scope.has(node.id)) { continue; }
    const position = cached?.get(node.id);
    elements.push({
      group: 'nodes',
      data: { id: node.id, label: node.label, kind: node.kind },
      ...(position ? { position } : {}),
    });
  }
  for (const edge of graphEdges) {
    if (!scope.has(edge.from) || !scope.has(edge.to)) { continue; }
    elements.push({
      group: 'edges',
      data: { id: `${edge.from}|${edge.to}`, source: edge.from, target: edge.to },
    });
  }
  return elements;
}

export function resizeGraph(): void {
  instance?.resize();
}

export function renderGraph(container: HTMLElement): void {
  if (building) { return; }
  const sig = filtersSignature();
  const hasWrap = Boolean(container.querySelector('.graph-wrap'));
  if (instance && hasWrap && buildSig === sig) {
    updateInstance(instance);
    return;
  }
  if (instance) {
    instance.destroy();
    instance = null;
  }
  buildSig = '';

  container.innerHTML = `
    <div class="graph-wrap">
      <div id="cy" style="width:100%;height:100%;"></div>
      ${legendHtml()}
      <div class="graph-overlay">Calculando distribución…</div>
    </div>`;
  building = true;

  // doble rAF: el overlay pinta antes de que fcose ocupe el hilo principal
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const cyContainer = container.querySelector<HTMLElement>('#cy');
      const overlay = container.querySelector<HTMLElement>('.graph-overlay');
      if (!container.querySelector('.graph-wrap') || !cyContainer || !overlay) {
        building = false;
        return;
      }

      let finished = false;
      const done = (): void => {
        if (finished) { return; }
        finished = true;
        overlay.remove();
        building = false;
        // cambios de estado llegaron mientras se construía → re-render
        if (filtersSignature() !== buildSig) { notify(); }
      };

      const liveSig = filtersSignature();
      const cached = posCache.get(liveSig);
      const elements = buildElements(cached);

      let cy: cytoscape.Core;
      try {
        cy = cytoscape({
          container: cyContainer,
          elements,
          style: GRAPH_STYLE,
          layout: { name: 'preset' },
          wheelSensitivity: 0.25,
          minZoom: 0.15,
          maxZoom: 3,
        });
      }
      catch (error) {
        console.error('[graph] no se pudo crear el grafo', error);
        done();
        return;
      }

      wireEvents(cy);
      instance = cy;
      buildSig = liveSig;
      updateInstance(cy);

      if (cached) {
        cy.layout({ name: 'preset', fit: true, padding: 30 }).run();
        done();
        return;
      }

      cy.one('layoutstop', () => {
        cachePositions(cy, liveSig);
        done();
      });
      window.setTimeout(done, 15_000);
      try {
        cy.layout({
          name: 'fcose',
          animate: false,
          randomize: true,
          quality: 'default',
          maxIterations: 500,
          nodeDimensionsIncludeLabels: false,
          padding: 30,
        } as unknown as cytoscape.LayoutOptions).run();
      }
      catch (error) {
        console.error('[graph] fcose falló, usando grid', error);
        try {
          cy.layout({ name: 'grid', animate: false, padding: 30 }).run();
          cachePositions(cy, liveSig);
        }
        catch { /* el grafo queda como esté */ }
        done();
      }
    });
  });
}
