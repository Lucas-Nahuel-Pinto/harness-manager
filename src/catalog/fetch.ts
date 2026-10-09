/**
 * MODEL CATALOG FETCH — source URLs, models.dev metadata, provider fetch, orchestration.
 *
 * Ported from the boilerplate harness (scripts/qa-model-selector.ts) so
 * harness-manager owns the fetch pipeline (spec §3.2–3.7). Keys come from the
 * injected env, are used transiently in request headers/URLs, and are never
 * persisted or logged (spec §3.3). The fetcher is injectable — tests inject
 * fakes and never touch the network. Individual source failures are tolerated
 * (original per-URL catch parity); every source failing resolves with an
 * empty catalog instead of throwing (spec §3.7–3.8).
 */

import type { ModelCatalog } from './cache.ts';
import type { ModelEntry, ModelsDevInfo } from './parsers.ts';
import { detectProvider, parseProvider } from './parsers.ts';

/** Strip query strings from URLs destined for logs — a query can carry a key (`?key=…`). */
function safeUrl(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/** Defense in depth: scrub any env secret values that leaked into an error message. */
function redactSecrets(text: string, env: Record<string, string | undefined>): string {
  let out = text;
  for (const value of [env.GOOGLE_API_KEY, env.ANTHROPIC_API_KEY, env.OPENAI_API_KEY, env.DEEPSEEK_API_KEY, env.KIMI_API_KEY]) {
    if (value && value.length >= 8) {
      out = out.split(value).join('***');
    }
  }
  return out;
}

/** models.dev metadata — deprecated models get filtered; provider info drives assignment. */
export const MODELS_DEV_URL = 'https://models.dev/api.json';

export interface FetchModelsOptions {
  /** Defaults to globalThis.fetch — tests inject fakes (zero network in tests). */
  fetchImpl?: typeof fetch
  /** Defaults to process.env — API keys + MODELS_CATALOG_URLS override (transient, never persisted). */
  env?: Record<string, string | undefined>
  /** Defaults to Date.now — injected for deterministic fetchedAt in tests. */
  now?: () => number
}

/**
 * Resolve the catalog source URLs from env. Pure over the injected env:
 * MODELS_CATALOG_URLS (comma-separated) overrides everything; otherwise the
 * two public OpenCode Zen endpoints plus one URL per provider whose key is
 * present. Conditional URLs are stored key-free — the key is injected at
 * fetch time (buildFetchUrl), never in the catalog's `sources` (spec §3.3).
 */
export function getCatalogUrls(env: Record<string, string | undefined>): string[] {
  const urls = env.MODELS_CATALOG_URLS;
  if (urls) {
    return urls.split(',').map(u => u.trim()).filter(Boolean);
  }
  // Default: OpenCode Zen + Go endpoints (public, no keys required)
  const defaultUrls = [
    'https://opencode.ai/zen/v1/models',
    'https://opencode.ai/zen/go/v1/models',
  ];
  // Google Gemini API only when the key exists; base URL keeps no key
  if (env.GOOGLE_API_KEY) {
    defaultUrls.push('https://generativelanguage.googleapis.com/v1beta/models');
  }
  if (env.ANTHROPIC_API_KEY) {
    defaultUrls.push('https://api.anthropic.com/v1/models');
  }
  if (env.OPENAI_API_KEY) {
    const base = env.OPENAI_API_BASE?.replace(/\/+$/, '') ?? 'https://api.openai.com/v1';
    defaultUrls.push(`${base}/models`);
  }
  if (env.DEEPSEEK_API_KEY) {
    defaultUrls.push('https://api.deepseek.com/models');
  }
  if (env.KIMI_API_KEY) {
    defaultUrls.push('https://api.moonshot.cn/v1/models');
  }
  return defaultUrls;
}

/** Fetch models.dev metadata → Map keyed by model id. Degraded-tolerant: warn + empty map, never throw. */
export async function fetchModelsDevMetadata(fetchImpl: typeof fetch): Promise<Map<string, ModelsDevInfo>> {
  const metaMap = new Map<string, ModelsDevInfo>();
  try {
    const response = await fetchImpl(MODELS_DEV_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.warn(`models.dev returned ${response.status}`);
      return metaMap;
    }
    const data = await response.json() as Record<string, unknown>;
    const oc = data.opencode as Record<string, unknown> | undefined;
    if (!oc || typeof oc !== 'object') {
      return metaMap;
    }
    const models = oc.models as Record<string, Record<string, unknown>> | undefined;
    if (!models || typeof models !== 'object') {
      return metaMap;
    }
    for (const [id, model] of Object.entries(models)) {
      const status = typeof model.status === 'string' ? model.status : 'active';
      // Use models.dev provider info if available (more accurate than owned_by)
      const providerInfo = model.provider as Record<string, unknown> | undefined;
      const npm = typeof providerInfo?.npm === 'string' ? providerInfo.npm : '';
      let provider = 'opencode';
      if (npm.includes('google')) {
        provider = 'google';
      }
      else if (npm.includes('anthropic')) {
        provider = 'anthropic';
      }
      else if (npm.includes('openai')) {
        provider = 'openai';
      }
      metaMap.set(id, { status, provider });
    }
  }
  catch (e) {
    console.warn(`Failed to fetch models.dev metadata: ${(e as Error).message}`);
  }
  return metaMap;
}

/** Per-request auth headers for a provider. Keys are read from env, returned for this request only. */
export function buildAuthHeaders(provider: string, env: Record<string, string | undefined>): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const keyMap: Record<string, string | undefined> = {
    'anthropic': env.ANTHROPIC_API_KEY,
    'openai-direct': env.OPENAI_API_KEY,
    'deepseek': env.DEEPSEEK_API_KEY,
    'kimi': env.KIMI_API_KEY,
  };
  const key = keyMap[provider];
  if (!key) { return headers; }
  if (provider === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  }
  else {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

/** Per-request URL shaping: Google injects its key as a query param (stored sources stay key-free). */
export function buildFetchUrl(provider: string, url: string, env: Record<string, string | undefined>): string {
  if (provider === 'google') {
    const key = env.GOOGLE_API_KEY;
    if (key) { return `${url}?key=${key}`; }
  }
  return url;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, ms));
}

const FETCH_RETRIES = 2;

interface ProviderResult {
  models: ModelEntry[]
  ok: boolean
}

/** Fetch one source URL. Never throws — failures come back as `{ models: [], ok: false }` (original parity). */
async function fetchFromProvider(
  url: string,
  metaMap: Map<string, ModelsDevInfo>,
  fetchImpl: typeof fetch,
  env: Record<string, string | undefined>,
): Promise<ProviderResult> {
  const provider = detectProvider(url);
  try {
    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
      const response = await fetchImpl(buildFetchUrl(provider, url, env), {
        headers: buildAuthHeaders(provider, env),
        signal: AbortSignal.timeout(10000),
      });

      // Retry on rate-limit (429) and transient server errors (5xx) with backoff.
      if ((response.status === 429 || response.status >= 500) && attempt < FETCH_RETRIES) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        console.warn(`Provider ${provider} returned ${response.status}`);
        return { models: [], ok: false };
      }

      const data = await response.json() as unknown;
      return { models: parseProvider(provider, data, url, metaMap), ok: true };
    }
    console.warn(`Provider ${provider} exhausted retries`);
    return { models: [], ok: false };
  }
  catch (e) {
    console.warn(`Failed to fetch from ${safeUrl(url)}: ${redactSecrets((e as Error).message, env)}`);
    return { models: [], ok: false };
  }
}

/**
 * Fetch the full catalog: models.dev metadata + every source URL in parallel
 * (allSettled, per-request 10s timeout), then dedupe + models.dev
 * deprecated-filter. `sources` records only the URLs that succeeded (spec
 * §3.7). Total failure resolves with `{ models: [], sources: [] }` — never
 * throws (spec §3.8).
 */
export async function fetchModels(opts: FetchModelsOptions = {}): Promise<ModelCatalog> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;

  const urls = getCatalogUrls(env);
  const metaMap = await fetchModelsDevMetadata(fetchImpl);

  const results = await Promise.allSettled(
    urls.map(async url => fetchFromProvider(url, metaMap, fetchImpl, env)),
  );

  const seen = new Set<string>();
  const deduped: ModelEntry[] = [];
  const sources: string[] = [];
  results.forEach((result, index) => {
    const url = urls[index];
    if (result.status === 'rejected') {
      console.warn(`Failed to fetch from ${safeUrl(url)}: ${redactSecrets(String(result.reason), env)}`);
      return;
    }
    if (result.value.ok) {
      sources.push(url);
    }
    for (const m of result.value.models) {
      if (seen.has(m.id)) {
        continue;
      }
      // Check models.dev status — filter deprecated models (not in /models menu)
      const rawId = m.id.replace(/^(?:opencode-go|opencode)\//, '');
      const meta = metaMap.get(rawId);
      if (meta?.status === 'deprecated') {
        continue;
      }
      seen.add(m.id);
      deduped.push(m);
    }
  });

  return {
    models: deduped,
    fetchedAt: now(),
    sources,
  };
}
