import type { ComputeResult } from './types.ts';
import { existsSync, readFileSync } from 'node:fs';
import { scanHarness } from '../scan/index.ts';
import { parseJsonc } from '../scan/jsonc.ts';
import { loadManifest } from '../scan/manifest.ts';
import { resolveInRoot } from './guard.ts';
import { locatePath } from './locate.ts';
import { fail, okEdit } from './types.ts';

const MODEL_ID_RE = /^[\w.\-/]+$/;

/**
 * Rewrite the model for a subagent (frontmatter `model:` line) or the main session
 * (`"<jsonPath>"` scalar in the manifest-declared config file). Rest of the file stays
 * byte-identical. The agent is resolved against a FRESH scan — the client never supplies a path.
 */
export async function computeModelSet(rootAbs: string, payload: Record<string, unknown>): Promise<ComputeResult> {
  const { agentId, model } = payload;
  if (typeof agentId !== 'string' || agentId.length === 0) { return fail(400, 'bad_payload', 'agentId vacío'); }
  if (typeof model !== 'string' || !MODEL_ID_RE.test(model)) {
    return fail(400, 'bad_payload', 'model inválido (se espera un id del catálogo)');
  }

  const { snapshot, error } = await scanHarness(rootAbs);
  if (!snapshot) { return fail(500, 'scan_failed', error ?? 'scan failed'); }
  const agent = snapshot.agents.find(candidate => candidate.id === agentId);
  if (!agent) { return fail(400, 'agent_not_found', `no existe el agente "${agentId}"`); }

  // The fresh scan already refreshed and read the shared catalog store (option B).
  const allowed = new Set(snapshot.catalog.models.map(entry => entry.id));
  if (agent.model) { allowed.add(agent.model); }
  if (!allowed.has(model)) {
    return fail(400, 'invalid_model', `"${model}" no está en el catálogo compartido ni es el modelo actual (${allowed.size} opciones)`);
  }
  if (model === agent.model) {
    const summary = `Modelo de ${agent.name} ya es "${model}" (sin cambios)`;
    const relPath = agent.path;
    const absPath = resolveInRoot(rootAbs, relPath);
    if (!absPath || !existsSync(absPath)) { return fail(400, 'file_not_found', `no existe ${relPath}`); }
    const text = readFileSync(absPath, 'utf8');
    return okEdit({ relPath, absPath, oldText: text, newText: text, summary });
  }

  return agent.isMain
    ? computeMain(rootAbs, loadManifest(rootAbs).manifest, model)
    : computeSubagent(rootAbs, agent.path, agent.name, model);
}

function computeMain(
  rootAbs: string,
  manifest: ReturnType<typeof loadManifest>['manifest'],
  model: string,
): ComputeResult {
  const cfg = manifest.models?.main ?? { file: 'opencode.jsonc', jsonPath: 'model' };
  if (cfg.jsonPath.includes('.')) {
    return fail(400, 'unsupported_json_path', `jsonPath anidado no soportado en v1: "${cfg.jsonPath}"`);
  }
  const absPath = resolveInRoot(rootAbs, cfg.file);
  if (!absPath) { return fail(400, 'path_escape', `ruta fuera del harness root: ${cfg.file}`); }
  if (!existsSync(absPath)) { return fail(400, 'file_not_found', `no existe ${cfg.file}`); }

  const text = readFileSync(absPath, 'utf8');
  const parsed = parseJsonc<Record<string, unknown>>(text);
  if (!parsed.value) { return fail(400, 'config_invalid', `${cfg.file}: ${parsed.error}`); }

  const loc = locatePath(text, [cfg.jsonPath]);
  if (!loc) { return fail(400, 'edit_unsafe', `no se encontró "${cfg.jsonPath}" en ${cfg.file}`); }
  if (text[loc.valueStart] !== '"') { return fail(400, 'edit_unsafe', `"${cfg.jsonPath}" no es un string en ${cfg.file}`); }

  const newText = `${text.slice(0, loc.valueStart)}${JSON.stringify(model)}${text.slice(loc.valueEnd)}`;
  const reparsed = parseJsonc<Record<string, unknown>>(newText);
  if (!reparsed.value) { return fail(400, 'edit_unsafe', `el edit deja JSON inválido: ${reparsed.error}`); }
  if (reparsed.value[cfg.jsonPath] !== model) { return fail(400, 'edit_unsafe', 'el nuevo valor no quedó aplicado'); }

  const summary = `Asignar modelo "${model}" al agente principal (${cfg.file})`;
  return okEdit({ relPath: cfg.file, absPath, oldText: text, newText, summary });
}

function computeSubagent(rootAbs: string, relPath: string, agentName: string, model: string): ComputeResult {
  const absPath = resolveInRoot(rootAbs, relPath);
  if (!absPath) { return fail(400, 'path_escape', `ruta fuera del harness root: ${relPath}`); }
  if (!existsSync(absPath)) { return fail(400, 'file_not_found', `no existe ${relPath}`); }

  const text = readFileSync(absPath, 'utf8');
  const newText = rewriteFrontmatterModel(text, model);
  if (newText === null) { return fail(400, 'no_frontmatter', `${relPath} no tiene frontmatter --- ... ---`); }
  if (newText === text) { return okEdit({ relPath, absPath, oldText: text, newText, summary: `Modelo de ${agentName} ya es "${model}" (sin cambios)` }); }

  const summary = `Asignar modelo "${model}" al agente ${agentName}`;
  return okEdit({ relPath, absPath, oldText: text, newText, summary });
}

/** Replace the `model:` line inside the frontmatter (insert after `---` when absent). */
export function rewriteFrontmatterModel(text: string, model: string): string | null {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') { return null; }

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) { close = i; break; }
  }
  if (close === -1) { return null; }

  for (let i = 1; i < close; i++) {
    const match = /^(\s*)model\s*:/.exec(lines[i]);
    if (match) {
      lines[i] = `${match[1]}model: ${model}`;
      return lines.join(eol);
    }
  }
  lines.splice(1, 0, `model: ${model}`);
  return lines.join(eol);
}
