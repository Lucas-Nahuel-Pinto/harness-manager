import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Global test seam for the shared catalog store (option B): every test process gets its own
 * temp store seeded with the demo model and a far-future `fetchedAt`, so `refreshModelCatalog`
 * treats it as fresh — the suite never touches the real `data/` store nor the network.
 * Tests that exercise refresh override `MODELS_CATALOG_PATH` per-test and restore it.
 */
const storeDir = join(tmpdir(), `hm-catalog-store-${process.pid}`);
mkdirSync(storeDir, { recursive: true });

const store = join(storeDir, 'models.catalog.json');
writeFileSync(
  store,
  `${JSON.stringify(
    {
      models: [
        { id: 'opencode/demo-model', name: 'demo-model', provider: 'demo', source: 'test://seed', capabilities: [] },
      ],
      fetchedAt: 4_000_000_000_000,
      sources: ['test://seed'],
    },
    null,
    2,
  )}\n`,
  'utf8',
);

process.env.MODELS_CATALOG_PATH = store;
