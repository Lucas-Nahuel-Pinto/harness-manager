import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Online-only build (spec 2026-10-11 §3.6): the UI lives on the hosted site, the bundle embeds
// ZERO harness data. Local dev runs the SAME online flow through the dev relay — there is no
// /api proxy anymore (spec 2026-10-12): `bun run relay:dev` + `bun run dev` →
// http://localhost:5173/?relay=ws://127.0.0.1:8788 → launcher → `bun agent.ts <CODE> --relay …`
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'esnext',
    outDir: 'dist-online',
    emptyOutDir: true,
  },
});
