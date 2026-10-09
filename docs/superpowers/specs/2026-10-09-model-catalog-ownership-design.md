# Harness Manager Model Catalog Ownership — Design

## 1. Problem

The model-catalog fetch pipeline lives inside every harness (boilerplate):

- `scripts/qa-model-selector.ts` (~870 lines) — source URLs, models.dev metadata, deprecated filter, auth headers, cache orchestration.
- `scripts/qa-model-parsers.ts` (249 lines) — per-provider response parsers.
- `.models.catalog.json` — 62 KB cache committed to the harness repo, so every refresh is commit noise (e.g. `f69344b chore: refresh model catalog`).
- Refresh means `bun run harness-config roles --refresh` inside the harness — the fetch code must be maintained in every harness copy.

Harness-manager already consumes the catalog (scan → `CatalogModel`, `model-set` action validation, registry display) and contains a **dead, spawn-based** refresh helper (`refreshModelCatalogIfAvailable` in `src/scan/misc.ts` — no callers) that shells out to the harness's own refresh script.

## 2. Goal

Harness-manager owns fetch + catalog write. The harness keeps read, TTL, picker, and validation. The boilerplate loses the fetch pipeline entirely.

```
BEFORE:  harness --refresh (fetch+write)  ──>  .models.catalog.json  <──  harness-manager (read only)
AFTER:   harness-manager (fetch+write)    ──>  .models.catalog.json  <──  harness (read only, offline graceful)
```

## 3. Binding decisions

1. **Catalog contract unchanged.** File format stays `{ models: ModelEntry[], fetchedAt, sources }` at `<harnessRoot>/<manifest.models.catalog ?? .models.catalog.json>`. The boilerplate loader (`scripts/model-catalog.ts`) works untouched.
2. **Native fetch, no subprocess.** Harness-manager fetches with `fetch()` in its own process. The spawn-based `refreshModelCatalogIfAvailable` is replaced, not refactored. The `Bun.spawn never spawnSync` rule becomes moot here (no spawn at all).
3. **Keys: harness-manager `process.env` only.** API keys (`GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_API_BASE`, `DEEPSEEK_API_KEY`, `KIMI_API_KEY`) and the `MODELS_CATALOG_URLS` override are read from the harness-manager process environment, used transiently in request headers/URLs, never persisted, never displayed, never read from harness `.env` files. Rule "harness-manager never reads `.env` values" stays intact.
4. **Default sources = public endpoints** (no keys required): `https://opencode.ai/zen/v1/models`, `https://opencode.ai/zen/go/v1/models`, plus `https://models.dev/api.json` metadata (deprecated filter + provider inference). Conditional provider sources (Google / Anthropic / OpenAI / DeepSeek / Kimi) append only when their key exists — parity with today's `getCatalogUrls()`.
5. **Write scope = harness declares interest.** Write the catalog only when the harness signals it wants one: manifest declares `models`, the catalog file already exists, or `package.json` has a `harness-config` script. Arbitrary harnesses are never littered.
6. **Trigger = rescan, await-if-stale.** On the rescan path (`GET /api/snapshot` → `scanHarness`), if the harness declares interest and the catalog is missing or older than TTL (default 24h, `MODELS_CACHE_TTL` honored), await the refresh (per-request `AbortSignal.timeout(10000)`, `Promise.allSettled` across sources, hard budget ~15 s) **before** the synchronous scan reads the file — no read/write race. On total failure: keep the existing file, push a snapshot warning, continue.
7. **Partial success writes.** Individual source failures are tolerated (parity with today's per-URL catch): succeeded sources are written, failed ones recorded in `sources`-style warnings. Atomic write (temp file + rename) so a torn read is impossible.
8. **Stale-while-on-failure.** If refresh fails entirely, the old file stays and remains readable by TTL rules — degraded, never broken.

## 4. Architecture

```
src/catalog/
  parsers.ts    ModelEntry + ModelsDevInfo types + per-provider parsers + provider/capability inference
                (ported from boilerplate scripts/qa-model-parsers.ts)
  fetch.ts      getCatalogUrls() (process.env) + models.dev metadata + fetchFromProvider + fetchModels()
                fetcher is injectable (fetchImpl param) for tests
  cache.ts      readCatalog/writeCatalog (atomic) + isStale + declaresInterest(root, manifest)

src/scan/misc.ts   refreshModelCatalogIfAvailable → replaced by native refreshModelCatalog(root, catalogFile)
                   (deletes detectBoilerplateModelScript + Bun.spawn block)
src/server/app.ts  rescan handler: await refresh-if-stale → scanHarness(...)
```

- `CatalogModel { id, name, provider }` (display/validation shape) is unchanged; the full `ModelEntry` fields are written to disk for boilerplate consumers.
- The engine serves the rescan (server-side fetch — no CORS/browser involvement).
- Online mode: catalog refresh happens on the local engine only; the hosted UI keeps rendering whatever the snapshot carries (no new endpoint).

## 5. Code changes (harness-manager)

| File | Change |
| --- | --- |
| `src/catalog/parsers.ts` | new — ported parsers + `ModelEntry` |
| `src/catalog/fetch.ts` | new — sources, models.dev metadata, deprecated filter, orchestration, injectable fetch |
| `src/catalog/cache.ts` | new — TTL read, atomic write, interest declaration |
| `src/scan/misc.ts` | replace spawn-based refresh with native `refreshModelCatalog` |
| `src/server/app.ts` | await-if-stale refresh before `scanHarness` |
| `tests/catalog-*.test.ts` | parsers, fetch (injected fetcher), cache/staleness, refresh failure modes |
| `docs/acceptance.md` | new checklist item L13 (catalog owned by harness-manager) |

## 6. Code changes (boilerplate — separate repo, separate commit)

| File | Change |
| --- | --- |
| `scripts/qa-model-selector.ts` | strip fetch pipeline (URLs, models.dev, auth, fetchModels); `--refresh` prints "refresh moved to harness-manager"; picker/role logic stays |
| `scripts/qa-model-parsers.ts` | delete; `ModelEntry` type moves to `scripts/model-catalog.ts` |
| `.gitignore` | add `.models.catalog.json`; `git rm --cached` the committed cache |
| gate | `bun run repo:check` green in the boilerplate repo |

## 7. Testing

- **Parsers**: one case per provider shape (Anthropic, Google, OpenAI-compatible, flat array) with sample payloads; capability/provider inference.
- **Fetch**: injected fetcher — all sources OK / models.dev down (degraded metadata) / all sources down → throws-or-empty per contract; `MODELS_CATALOG_URLS` override honored.
- **Cache**: stale vs fresh TTL, atomic write leaves no temp file, `declaresInterest` truth table (manifest / existing file / harness-config script / none).
- **Refresh wiring**: refresh failure pushes a snapshot warning and does not fail the rescan; existing `tests/scan.test.ts` catalog expectations stay green.
- **Gate**: `bun run repo:check` (format → lint → types → types:relay → bun test).

## 8. Non-goals (v1)

- No UI "refresh catalog" button (rescan trigger is enough).
- No reading harness `.env` files (decision 3).
- No moving the picker / role selection / agent-file model update out of the harness — selection UX stays harness-side.
- No provider pagination / rate-limit handling beyond current parity.
- No hosted-UI endpoint for the catalog (online mode renders the snapshot as-is).

## 9. Implementation phases (summary — detail lives in the implementation plan)

1. Phase 1 — `src/catalog/` module (parsers, fetch, cache) + unit tests.
2. Phase 2 — rescan wiring, spawn helper removal, scan tests, README note.
3. Phase 3 — gate + commits (harness-manager).
4. Phase 4 — boilerplate strip + gitignore + gate (separate repo, user-approved commit).

## 10. Open items

- Whether a "last refreshed at" surface belongs in the registry card later (cosmetic; skipped v1).
- `MODELS_CACHE_FILE` override currently boilerplate-side only; harness-manager writes to the manifest path. If a harness needs a relocated cache, it declares it via manifest — no extra config invented here.
