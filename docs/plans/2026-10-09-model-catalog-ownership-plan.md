# Harness Manager Model Catalog Ownership — Implementation Plan

**Date:** 2026-10-09 · **Spec:** `docs/superpowers/specs/2026-10-09-model-catalog-ownership-design.md` (binding)
**Flow:** Phase → Code → Verify per phase · `bun run repo:check` must be green at every phase boundary.

---

## Phase 1 — `src/catalog/` module + unit tests

**Tasks**

1. `src/catalog/parsers.ts` — port from boilerplate `scripts/qa-model-parsers.ts` (logic verbatim, imports adjusted): `ModelEntry`, `ModelsDevInfo`, `inferCapabilities`, `inferUnderlyingProvider`, `detectProvider`, `prefixForProvider`, `parseAnthropic`, `parseGoogle`, `parseOpenAICompatible`, `parseFlatArray`, `parseProvider`. Parsers stay pure — no logging side effects (warnings surface in `fetch.ts`).
2. `src/catalog/fetch.ts` — port fetch orchestration from `scripts/qa-model-selector.ts`:
   - `getCatalogUrls(env)` — pure over injected env: defaults zen v1 + zen/go v1; conditional Google/Anthropic/OpenAI/DeepSeek/Kimi URLs when their key exists; `MODELS_CATALOG_URLS` override (comma-separated).
   - `fetchModelsDevMetadata(fetchImpl)` — models.dev `/api.json`, degraded-tolerant (warn + empty map).
   - `buildAuthHeaders` / `buildFetchUrl` — keys transient, returned per-request only.
   - `fetchModels({ fetchImpl?, env?, now? })` → `ModelCatalog { models, fetchedAt, sources }`: parallel `Promise.allSettled` over source URLs, per-request `AbortSignal.timeout(10000)`, deprecated filter via models.dev, `fetchedAt = now()`.
   - Signature: `fetchImpl` defaults to `globalThis.fetch` (tests inject fakes; **no network in tests**).
3. `src/catalog/cache.ts` — `readCatalog(path)` (parse → `ModelCatalog | null`), `isStale(catalog, ttlMs)` (default `MODELS_CACHE_TTL` 24h honored), `writeCatalogAtomic(path, catalog)` (write `.tmp` in same dir + `rename`), `declaresInterest(root, manifest)` — truth when manifest declares `models` OR catalog file exists OR `package.json.scripts['harness-config']` present (spec §3.5).
4. Tests (`tests/catalog-parsers.test.ts`, `tests/catalog-fetch.test.ts`, `tests/catalog-cache.test.ts`):
   - parsers: one payload per provider shape + capability/provider inference edge cases;
   - fetch: all-OK (sources recorded, counts), models.dev down (still returns models), all sources down (empty models + `sources: []`, no throw), `MODELS_CATALOG_URLS` override, key-gated URL expansion (fake env);
   - cache: stale/fresh TTL boundaries, atomic write (no `.tmp` left), `declaresInterest` truth table incl. negative case.

**Verify:** `bun run repo:check` green; zero network calls possible in test run (fake fetch only).

---

## Phase 2 — rescan wiring + spawn-helper removal

**Tasks**

1. `src/scan/misc.ts` — delete `detectBoilerplateModelScript` + spawn-based `refreshModelCatalogIfAvailable` (dead code); new native `refreshModelCatalog(root, catalogFile, opts: { fetchImpl? }): Promise<string | null>` — returns a warning string or `null`: skip when `!declaresInterest` or `!isStale`; fetch → `writeCatalogAtomic`; total failure → keep old file + warning (spec §3.6–3.8).
2. `src/scan/index.ts` — `scanHarness(rootInput, opts?: { fetchImpl? })` becomes **async**: `await refreshModelCatalog(...)` before `scanCatalog`, refresh warning pushed into the same `warnings` array (single seam, no read/write race — spec §3.6).
3. `src/server/app.ts` — `await scanHarness(rootAbs, …)` (only production caller).
4. Fixture catalogs (`tests/fixtures/*/…models.catalog.json`) get a far-future `fetchedAt` → `isStale` false → no fetch, no network in any test; refresh-behavior tests call `scanHarness`/`refreshModelCatalog` with an injected counting fake.
5. New tests in `tests/scan.test.ts` (or `tests/catalog-refresh.test.ts`): refresh failure → snapshot contains warning, rescan still succeeds; no-interest harness → fetch never invoked; stale catalog + fake fetch → file rewritten with new `fetchedAt`.
6. README — "Model catalog" subsection: harness-manager owns fetch; harness reads offline-gracefully; keys read from harness-manager `process.env` only; `MODELS_CATALOG_URLS` / `MODELS_CACHE_TTL` overrides.

**Verify:** `bun run repo:check` green (existing `tests/scan.test.ts` catalog expectations still pass); grep confirms `Bun.spawn`/`detectBoilerplateModelScript` gone from `src/scan/`.

---

## Phase 3 — Gate + docs + commits (harness-manager)

**Tasks**

1. `docs/acceptance.md` — add **L13**: catalog stale → rescan refreshes `.models.catalog.json` in the harness root, model-set validates against it, harness without interest is never written to.
2. Full gate `bun run repo:check` (format → lint → types → types:relay → bun test).
3. Commits (local only, no push): `feat: own model catalog fetch from harness-manager` (code + tests) then `docs: model catalog ownership spec, plan, acceptance` (spec + plan + README/acceptance).

**Verify:** `bun run repo:check` exit 0; `git status` clean except intentionally untracked; smoke: rescan against a real harness root with a stale catalog rewrites the file (manual, engine running).

---

## Phase 4 — Boilerplate strip (bunkai repo — separate gate, commit needs user OK)

**Tasks**

1. Move `ModelEntry` type into `scripts/model-catalog.ts`; delete `scripts/qa-model-parsers.ts`.
2. `scripts/qa-model-selector.ts` — strip fetch pipeline (URLs, models.dev, auth headers, `fetchModels`, `fetchFromProvider`); `--refresh` now prints "catalog refresh moved to harness-manager" (exit 0, no fetch); picker / role defs / agent-file update untouched.
3. Update `scripts/qa-model-selector.test.ts` for the removals (drop fetch cases already covered by harness-manager tests).
4. `.gitignore` += `.models.catalog.json`; `git rm --cached .models.catalog.json` (stops the commit-noise class entirely).
5. Gate: `bun run repo:check` green in the boilerplate repo; commit after explicit user approval (separate repo).

**Verify:** boilerplate `repo:check` exit 0; `grep -r "models.dev" scripts/` → 0 hits; `bun run harness-config roles` still opens the picker from an existing cache and degrades gracefully when the cache is absent.

---

## Risks / open points

- **Test network isolation** — the failure mode that matters: a committed fixture with an old `fetchedAt` would trigger real fetches. Mitigation: far-future fixture timestamps + injected `fetchImpl` everywhere (Phase 2 task 4). A stray real fetch would make tests flaky offline — grep the test run for `models.dev` before closing Phase 2.
- **`scanHarness` → async ripple** — only caller is `src/server/app.ts` plus tests; confined, but every test call site needs `await`.
- **Parser port drift** — port verbatim from the boilerplate (single source of truth until Phase 4); diff review against the original file in the PR/commit body checklist.
- **Degraded overwrite** — a refresh where most sources fail writes a smaller catalog over a larger one (spec parity with today). Accepted; `sources` records what landed, next successful refresh restores coverage.
- **Phase 4 `--refresh` behavior change** — harness-only users without harness-manager lose on-demand refresh; mitigation is the message + graceful picker degradation (catalog read path unchanged).
- **Boilerplate catalog currently committed** — until Phase 4 lands, new clones still carry the stale committed cache; harness-manager refresh fixes it on first rescan anyway.
