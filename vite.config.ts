import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Online-only build (spec 2026-10-11 §3.6): the UI lives on the hosted site, the bundle embeds
// ZERO harness data. Local dev: `bun server.ts --port 7399` + `bun run dev` — /api proxied.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'esnext',
    outDir: 'dist-online',
    emptyOutDir: true,
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:7399' },
  },
});
