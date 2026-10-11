/**
 * Electrobun app metadata + build entrypoints (pinned electrobun@1.18.1 — spec §8).
 * No type import from 'electrobun/bun': its TS sources fail this repo's strict
 * `tsc` gate; the electrobun CLI validates the shape when it loads this file.
 */
const config = {
  app: {
    name: 'harness-manager',
    identifier: 'com.harness-manager.app',
    version: '0.1.0',
  },
  build: {
    bun: { entrypoint: 'src/desktop/main.ts' },
    views: {
      mainview: { entrypoint: 'src/desktop/view/index.html' },
    },
  },
};

export default config;
