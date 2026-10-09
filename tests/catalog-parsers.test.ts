import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  detectProvider,
  inferCapabilities,
  inferUnderlyingProvider,
  parseAnthropic,
  parseFlatArray,
  parseGoogle,
  parseOpenAICompatible,
  parseProvider,
  prefixForProvider,
} from '../src/catalog/parsers.ts';

const SOURCE = 'https://example.test/v1/models';
const NO_META = new Map<string, { status: string, provider: string }>();

describe('inferCapabilities', () => {
  test('strong name hints map to capability tags', () => {
    expect(inferCapabilities('pixtral-large-vision')).toEqual(['vision']);
    expect(inferCapabilities('qwen3-coder')).toEqual(['code']);
    expect(inferCapabilities('deepseek-r1-reason')).toEqual(['reasoning']);
    expect(inferCapabilities('some-model-lite')).toEqual(['budget']);
  });

  test('free/mini are budget, not vision; flash alone implies nothing', () => {
    expect(inferCapabilities('gpt-4o-mini')).toEqual(['budget']);
    expect(inferCapabilities('deepseek-chat-free')).toEqual(['budget']);
    expect(inferCapabilities('grok-4-flash')).toEqual([]);
  });

  test('"gemini" contains "mini" → budget (heuristic quirk kept verbatim from the original)', () => {
    expect(inferCapabilities('gemini-2.5-flash')).toEqual(['budget']);
  });

  test('strong hints accumulate in declaration order', () => {
    expect(inferCapabilities('claude-opus-vision-pro')).toEqual(['vision', 'reasoning']);
  });

  test('unmatched ids get no capability tags', () => {
    expect(inferCapabilities('grok-4')).toEqual([]);
  });
});

describe('inferUnderlyingProvider', () => {
  test('strips provider prefixes before matching the vendor', () => {
    expect(inferUnderlyingProvider('opencode-go/glm-5.3')).toBe('zhipu');
    expect(inferUnderlyingProvider('opencode/claude-sonnet-4')).toBe('anthropic');
    expect(inferUnderlyingProvider('openai/gpt-5')).toBe('openai');
    expect(inferUnderlyingProvider('google/gemini-2.5-pro')).toBe('google');
    expect(inferUnderlyingProvider('deepseek/deepseek-r1')).toBe('deepseek');
    expect(inferUnderlyingProvider('kimi/kimi-k2')).toBe('moonshot');
  });

  test('matches bare vendor-prefixed ids', () => {
    expect(inferUnderlyingProvider('claude-haiku-4')).toBe('anthropic');
    expect(inferUnderlyingProvider('o3-mini')).toBe('openai');
    expect(inferUnderlyingProvider('codex-mini')).toBe('openai');
    expect(inferUnderlyingProvider('qwen3-32b')).toBe('alibaba');
    expect(inferUnderlyingProvider('grok-4')).toBe('xai');
    expect(inferUnderlyingProvider('minimax-m2')).toBe('minimax');
    expect(inferUnderlyingProvider('nemotron-ultra-free')).toBe('nvidia');
    expect(inferUnderlyingProvider('mimo-v2.6-flash-free')).toBe('opencode');
    expect(inferUnderlyingProvider('longcat-flash')).toBe('opencode');
  });

  test('unknown vendors fall back to other', () => {
    expect(inferUnderlyingProvider('mystery-model')).toBe('other');
  });
});

describe('detectProvider', () => {
  const savedBase = process.env.OPENAI_API_BASE;

  beforeEach(() => {
    delete process.env.OPENAI_API_BASE;
  });

  afterEach(() => {
    if (savedBase !== undefined) {
      process.env.OPENAI_API_BASE = savedBase;
    }
  });

  test('URL matching per endpoint', () => {
    expect(detectProvider('https://opencode.ai/zen/go/v1/models')).toBe('opencode-go');
    expect(detectProvider('https://opencode.ai/zen/v1/models')).toBe('opencode');
    expect(detectProvider('https://generativelanguage.googleapis.com/v1beta/models')).toBe('google');
    expect(detectProvider('https://api.anthropic.com/v1/models')).toBe('anthropic');
    expect(detectProvider('https://api.openai.com/v1/models')).toBe('openai-direct');
    expect(detectProvider('https://api.deepseek.com/models')).toBe('deepseek');
    expect(detectProvider('https://api.moonshot.cn/v1/models')).toBe('kimi');
    expect(detectProvider('https://openai-proxy.example.com/v1/models')).toBe('openai');
    expect(detectProvider('https://acme-corp.example/v1/models')).toBe('custom');
  });

  test('OPENAI_API_BASE proxy hint maps to openai-direct', () => {
    process.env.OPENAI_API_BASE = 'https://proxy.corp.example/v1';
    try {
      expect(detectProvider('https://proxy.corp.example/v1/models')).toBe('openai-direct');
      expect(detectProvider('https://acme-corp.example/v1/models')).toBe('custom');
    }
    finally {
      delete process.env.OPENAI_API_BASE;
    }
  });
});

describe('prefixForProvider', () => {
  test('adds canonical prefixes only for prefixed providers', () => {
    expect(prefixForProvider('opencode-go', 'glm-5.3')).toBe('opencode-go/glm-5.3');
    expect(prefixForProvider('opencode', 'grok-4')).toBe('opencode/grok-4');
    expect(prefixForProvider('openai-direct', 'gpt-5')).toBe('openai/gpt-5');
    expect(prefixForProvider('deepseek', 'deepseek-r1')).toBe('deepseek/deepseek-r1');
    expect(prefixForProvider('kimi', 'kimi-k2')).toBe('kimi/kimi-k2');
    expect(prefixForProvider('anthropic', 'claude-4')).toBe('claude-4');
    expect(prefixForProvider('google', 'gemini-2.5-pro')).toBe('gemini-2.5-pro');
  });
});

describe('parseAnthropic', () => {
  test('parses { data: [{ id, display_name }] }', () => {
    const payload = {
      data: [
        { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' },
        { id: 'claude-vision-latest' },
      ],
    };
    expect(parseAnthropic(payload, SOURCE)).toEqual([
      {
        id: 'anthropic/claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        source: SOURCE,
        capabilities: [],
      },
      {
        id: 'anthropic/claude-vision-latest',
        name: 'claude-vision-latest',
        provider: 'anthropic',
        source: SOURCE,
        capabilities: ['vision'],
      },
    ]);
  });

  test('non-array data and non-string ids yield []', () => {
    expect(parseAnthropic({}, SOURCE)).toEqual([]);
    expect(parseAnthropic({ data: [{ display_name: 'no id' }] }, SOURCE)).toEqual([]);
  });
});

describe('parseGoogle', () => {
  test('parses { models: [{ name: "models/…", displayName }] }', () => {
    const payload = {
      models: [
        { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
        { name: 'models/gemini-flash' },
      ],
    };
    expect(parseGoogle(payload, SOURCE)).toEqual([
      {
        id: 'google/gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: 'google',
        source: SOURCE,
        // 'gemini' contains 'mini' → budget (verbatim heuristic quirk)
        capabilities: ['reasoning', 'budget'],
      },
      {
        id: 'google/gemini-flash',
        name: 'gemini-flash',
        provider: 'google',
        source: SOURCE,
        capabilities: ['budget'],
      },
    ]);
  });

  test('missing or empty name entries are skipped', () => {
    expect(parseGoogle({}, SOURCE)).toEqual([]);
    expect(parseGoogle({ models: [{ displayName: 'orphan' }] }, SOURCE)).toEqual([]);
  });
});

describe('parseOpenAICompatible', () => {
  test('models.dev meta provider wins over owned_by', () => {
    const meta = new Map([['grok-4', { status: 'active', provider: 'xai' }]]);
    const payload = { data: [{ id: 'grok-4', owned_by: 'xai-org' }] };
    const models = parseOpenAICompatible(payload, SOURCE, 'opencode', meta);
    expect(models[0].id).toBe('opencode/grok-4');
    expect(models[0].provider).toBe('xai');
  });

  test('falls back to owned_by, then the source provider', () => {
    const withOwner = parseOpenAICompatible({ data: [{ id: 'glm-5.3', owned_by: 'zhipu' }] }, SOURCE, 'opencode', NO_META);
    expect(withOwner[0].provider).toBe('zhipu');
    const withoutOwner = parseOpenAICompatible({ data: [{ id: 'mystery-1' }] }, SOURCE, 'opencode', NO_META);
    expect(withoutOwner[0].provider).toBe('opencode');
    expect(withoutOwner[0].name).toBe('mystery-1');
  });

  test('openai-direct forces provider openai and openai/ prefix', () => {
    const models = parseOpenAICompatible({ data: [{ id: 'gpt-5' }] }, SOURCE, 'openai-direct', NO_META);
    expect(models[0].id).toBe('openai/gpt-5');
    expect(models[0].provider).toBe('openai');
  });

  test('non-array data and non-string ids yield []', () => {
    expect(parseOpenAICompatible({ data: 'nope' }, SOURCE, 'opencode', NO_META)).toEqual([]);
    expect(parseOpenAICompatible({ data: [{ name: 'no-id' }] }, SOURCE, 'opencode', NO_META)).toEqual([]);
  });
});

describe('parseFlatArray', () => {
  test('parses [{ id, name?, provider?, capabilities? }]', () => {
    const payload = [
      { id: 'custom-1', name: 'Custom One', provider: 'acme', capabilities: ['vision'] },
      { id: 'custom-2' },
    ];
    expect(parseFlatArray(payload, SOURCE, 'fallback')).toEqual([
      { id: 'custom-1', name: 'Custom One', provider: 'acme', source: SOURCE, capabilities: ['vision'] },
      { id: 'custom-2', name: 'custom-2', provider: 'fallback', source: SOURCE, capabilities: [] },
    ]);
  });

  test('non-array payload and non-string ids yield []', () => {
    expect(parseFlatArray({ data: [] }, SOURCE, 'fallback')).toEqual([]);
    expect(parseFlatArray([{ name: 'no-id' }], SOURCE, 'fallback')).toEqual([]);
  });
});

describe('parseProvider', () => {
  test('dispatches by provider shape', () => {
    expect(parseProvider('anthropic', { data: [{ id: 'claude-4' }] }, SOURCE, NO_META)[0].id)
      .toBe('anthropic/claude-4');
    expect(parseProvider('google', { models: [{ name: 'models/gemini-2.5-pro' }] }, SOURCE, NO_META)[0].id)
      .toBe('google/gemini-2.5-pro');
    expect(parseProvider('opencode', { data: [{ id: 'grok-4' }] }, SOURCE, NO_META)[0].id)
      .toBe('opencode/grok-4');
    expect(parseProvider('custom', [{ id: 'flat-1' }], SOURCE, NO_META)[0].id)
      .toBe('flat-1');
    expect(parseProvider('custom', { unexpected: true }, SOURCE, NO_META)).toEqual([]);
  });
});
