import { describe, expect, spyOn, test } from 'bun:test';
import {
  buildAuthHeaders,
  buildFetchUrl,
  fetchModels,
  getCatalogUrls,
  MODELS_DEV_URL,
} from '../src/catalog/fetch.ts';

const ZEN = 'https://opencode.ai/zen/v1/models';
const ZEN_GO = 'https://opencode.ai/zen/go/v1/models';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

interface FakeRoute {
  fetchImpl: typeof fetch
  calls: string[]
}

/** Route-aware fake fetch — unmatched URLs throw, so any stray request fails the test loudly. */
function fakeFetch(routes: Record<string, Response | (() => Response)>): FakeRoute {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url === prefix || url.startsWith(`${prefix}?`)) {
        return typeof handler === 'function' ? handler() : handler.clone();
      }
    }
    throw new Error(`unrouted fetch: ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const EMPTY_DEV = { opencode: { models: {} } };

describe('getCatalogUrls', () => {
  test('default is the two public Zen endpoints', () => {
    expect(getCatalogUrls({})).toEqual([ZEN, ZEN_GO]);
  });

  test('MODELS_CATALOG_URLS overrides everything, trimmed and emptied entries dropped', () => {
    const env = {
      MODELS_CATALOG_URLS: ` ${ZEN} , https://b.example/v1/models ,, `,
      GOOGLE_API_KEY: 'g-secret',
      ANTHROPIC_API_KEY: 'a-secret',
    };
    expect(getCatalogUrls(env)).toEqual([ZEN, 'https://b.example/v1/models']);
  });

  test('provider URLs append only when their key exists', () => {
    expect(getCatalogUrls({ GOOGLE_API_KEY: 'k' })).toContain('https://generativelanguage.googleapis.com/v1beta/models');
    expect(getCatalogUrls({ ANTHROPIC_API_KEY: 'k' })).toContain('https://api.anthropic.com/v1/models');
    expect(getCatalogUrls({ DEEPSEEK_API_KEY: 'k' })).toContain('https://api.deepseek.com/models');
    expect(getCatalogUrls({ KIMI_API_KEY: 'k' })).toContain('https://api.moonshot.cn/v1/models');
    expect(getCatalogUrls({ OPENAI_API_KEY: 'k' })).toContain('https://api.openai.com/v1/models');
    expect(getCatalogUrls({ OPENAI_API_KEY: 'k', OPENAI_API_BASE: 'https://proxy.corp.example/v1/' }))
      .toContain('https://proxy.corp.example/v1/models');
    // no key → no conditional URL, Google base stays key-free
    expect(getCatalogUrls({ GOOGLE_API_KEY: 'k' })).not.toContain('g-secret');
    expect(getCatalogUrls({})).toHaveLength(2);
  });
});

describe('buildAuthHeaders / buildFetchUrl', () => {
  test('anthropic uses x-api-key + version header', () => {
    expect(buildAuthHeaders('anthropic', { ANTHROPIC_API_KEY: 'a-secret' })).toEqual({
      'Accept': 'application/json',
      'x-api-key': 'a-secret',
      'anthropic-version': '2023-06-01',
    });
  });

  test('bearer providers and missing keys', () => {
    expect(buildAuthHeaders('kimi', { KIMI_API_KEY: 'k-secret' }).Authorization).toBe('Bearer k-secret');
    expect(buildAuthHeaders('openai-direct', { OPENAI_API_KEY: 'o-secret' }).Authorization).toBe('Bearer o-secret');
    expect(buildAuthHeaders('deepseek', { DEEPSEEK_API_KEY: 'd-secret' }).Authorization).toBe('Bearer d-secret');
    expect(buildAuthHeaders('kimi', {})).toEqual({ Accept: 'application/json' });
    expect(buildAuthHeaders('opencode', { KIMI_API_KEY: 'k-secret' })).toEqual({ Accept: 'application/json' });
  });

  test('google injects the key as a query param, others pass through', () => {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models';
    expect(buildFetchUrl('google', url, { GOOGLE_API_KEY: 'g-secret' })).toBe(`${url}?key=g-secret`);
    expect(buildFetchUrl('google', url, {})).toBe(url);
    expect(buildFetchUrl('opencode', ZEN, { GOOGLE_API_KEY: 'g-secret' })).toBe(ZEN);
  });
});

describe('fetchModels', () => {
  test('all sources OK → models, sources recorded, injected now wins', async () => {
    const { fetchImpl, calls } = fakeFetch({
      [ZEN]: json({
        data: [
          { id: 'grok-4', owned_by: 'xai' },
          { id: 'gemini-2.5-pro' },
          { id: 'old-model' },
        ],
      }),
      [ZEN_GO]: json({ data: [{ id: 'glm-5.3', owned_by: 'zhipu' }] }),
      [MODELS_DEV_URL]: json({
        opencode: {
          models: {
            'gemini-2.5-pro': { status: 'active', provider: { npm: '@ai-sdk/google' } },
            'old-model': { status: 'deprecated', provider: { npm: '@ai-sdk/openai' } },
          },
        },
      }),
    });

    const catalog = await fetchModels({ fetchImpl, env: {}, now: () => 1_700_000_000_000 });

    expect(catalog.fetchedAt).toBe(1_700_000_000_000);
    expect(catalog.sources).toEqual([ZEN, ZEN_GO]);
    expect(catalog.models.map(m => m.id)).toEqual(['opencode/grok-4', 'opencode/gemini-2.5-pro', 'opencode-go/glm-5.3']);
    // models.dev provider inference (npm → google) beats missing owned_by
    expect(catalog.models[1].provider).toBe('google');
    // deprecated model filtered via models.dev
    expect(catalog.models.map(m => m.id)).not.toContain('opencode/old-model');
    // no API key ever lands in stored sources
    expect(catalog.sources.join()).not.toContain('secret');
    expect(calls).toHaveLength(3);
  });

  test('models.dev down → degraded metadata, sources still fetched', async () => {
    const { fetchImpl } = fakeFetch({
      [ZEN]: json({ data: [{ id: 'grok-4', owned_by: 'xai' }] }),
      [ZEN_GO]: json({ data: [] }),
      [MODELS_DEV_URL]: () => {
        throw new Error('models.dev unreachable');
      },
    });

    const catalog = await fetchModels({ fetchImpl, env: {}, now: () => 42 });

    expect(catalog.fetchedAt).toBe(42);
    expect(catalog.models.map(m => m.id)).toEqual(['opencode/grok-4']);
    expect(catalog.models[0].provider).toBe('xai'); // no meta → owned_by fallback
    expect(catalog.sources).toEqual([ZEN, ZEN_GO]);
  });

  test('models.dev HTTP error → degraded metadata, never throws', async () => {
    const { fetchImpl } = fakeFetch({
      [ZEN]: json({ data: [{ id: 'grok-4' }] }),
      [ZEN_GO]: json({ data: [] }),
      [MODELS_DEV_URL]: json({}, 503),
    });

    const catalog = await fetchModels({ fetchImpl, env: {}, now: () => 7 });
    expect(catalog.models).toHaveLength(1);
    expect(catalog.sources).toEqual([ZEN, ZEN_GO]);
  });

  test('all sources down → empty catalog, sources [], no throw', async () => {
    const { fetchImpl } = fakeFetch({
      [ZEN]: () => {
        throw new Error('ECONNREFUSED');
      },
      [ZEN_GO]: json({}, 404),
      [MODELS_DEV_URL]: json(EMPTY_DEV),
    });

    const catalog = await fetchModels({ fetchImpl, env: {}, now: () => 99 });

    expect(catalog).toEqual({ models: [], fetchedAt: 99, sources: [] });
  });

  test('partial failure → only the successful source is recorded (spec §3.7)', async () => {
    const { fetchImpl } = fakeFetch({
      [ZEN]: json({ data: [{ id: 'grok-4' }] }),
      [ZEN_GO]: () => {
        throw new Error('timeout');
      },
      [MODELS_DEV_URL]: json(EMPTY_DEV),
    });

    const catalog = await fetchModels({ fetchImpl, env: {}, now: () => 1 });

    expect(catalog.sources).toEqual([ZEN]);
    expect(catalog.models.map(m => m.id)).toEqual(['opencode/grok-4']);
  });

  test('MODELS_CATALOG_URLS override is what gets fetched', async () => {
    const a = 'https://a.example/v1/models';
    const b = 'https://b.example/v1/models';
    const { fetchImpl, calls } = fakeFetch({
      [a]: json({ data: [{ id: 'flat-a', provider: 'a' }] }),
      [b]: json({ data: [{ id: 'flat-b', provider: 'b' }] }),
      [MODELS_DEV_URL]: json(EMPTY_DEV),
    });

    const catalog = await fetchModels({
      fetchImpl,
      env: { MODELS_CATALOG_URLS: `${a}, ${b}`, GOOGLE_API_KEY: 'g-secret' },
      now: () => 5,
    });

    expect(catalog.sources).toEqual([a, b]);
    expect(catalog.models.map(m => m.id)).toEqual(['flat-a', 'flat-b']);
    const sourceCalls = calls.filter(url => url !== MODELS_DEV_URL);
    expect(sourceCalls).toEqual([a, b]);
    expect(sourceCalls.join()).not.toContain('generativelanguage');
  });

  test('google key is injected at fetch time, never stored in sources', async () => {
    const googleBase = 'https://generativelanguage.googleapis.com/v1beta/models';
    const { fetchImpl, calls } = fakeFetch({
      [ZEN]: json({ data: [{ id: 'grok-4' }] }),
      [ZEN_GO]: json({ data: [] }),
      [googleBase]: json({ models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' }] }),
      [MODELS_DEV_URL]: json(EMPTY_DEV),
    });

    const catalog = await fetchModels({ fetchImpl, env: { GOOGLE_API_KEY: 'g-secret' }, now: () => 6 });

    const googleCall = calls.find(url => url.startsWith(googleBase));
    expect(googleCall).toBe(`${googleBase}?key=g-secret`);
    expect(catalog.sources).toEqual([ZEN, ZEN_GO, googleBase]);
    expect(catalog.sources.join()).not.toContain('g-secret');
    expect(catalog.models.map(m => m.id)).toContain('google/gemini-2.5-flash');
  });

  test('retries 5xx with backoff, then succeeds (original parity)', async () => {
    let zenHits = 0;
    const { fetchImpl, calls } = fakeFetch({
      [ZEN]: () => {
        zenHits++;
        return zenHits === 1 ? json({}, 503) : json({ data: [{ id: 'grok-4' }] });
      },
      [MODELS_DEV_URL]: json(EMPTY_DEV),
    });

    const catalog = await fetchModels({
      fetchImpl,
      env: { MODELS_CATALOG_URLS: ZEN },
      now: () => 8,
    });

    expect(catalog.models.map(m => m.id)).toEqual(['opencode/grok-4']);
    expect(catalog.sources).toEqual([ZEN]);
    expect(calls.filter(url => url === ZEN)).toHaveLength(2);
  }, 10_000);
});

describe('fetchModels — warning redaction', () => {
  test('warnings never carry API keys or raw query keys', async () => {
    const googleBase = 'https://generativelanguage.googleapis.com/v1beta/models';
    const key = 'AIza-SYNTAX-SECRET-GOOGLE-KEY-123456';
    const fetchImpl = (async (input: RequestInfo | URL) => {
      throw new TypeError(`connect ECONNREFUSED ${String(input)}`);
    }) as unknown as typeof fetch;

    const warns: string[] = [];
    const spy = spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warns.push(args.map(String).join(' '));
    });
    try {
      await fetchModels({
        fetchImpl,
        env: { MODELS_CATALOG_URLS: googleBase, GOOGLE_API_KEY: key },
        now: () => 9,
      });
    }
    finally {
      spy.mockRestore();
    }

    expect(warns.length).toBeGreaterThan(0);
    for (const line of warns) {
      expect(line).not.toContain(key);
      expect(line).not.toMatch(/[?&]key=(?!\*\*\*)/);
    }
  });
});
