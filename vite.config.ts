import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => {
  const online = mode === 'online';
  return {
    plugins: [viteSingleFile()],
    define: {
      // Online build embeds no snapshot (src/snapshot.ts exports the empty shell instead).
      __HM_ONLINE__: JSON.stringify(online),
    },
    build: {
      target: 'esnext',
      outDir: online ? 'dist-online' : 'dist',
      emptyOutDir: true,
    },
  };
});
