import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  esbuild: { charset: 'ascii' },
  build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
});
