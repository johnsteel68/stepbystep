import { defineConfig } from 'vite';

// Keep browser assets separate and bundle server dependencies for Workers.
export default defineConfig({ publicDir: false, ssr: { noExternal: true }, build: {
  ssr: 'mcp/worker.ts', outDir: 'dist/server', emptyOutDir: false, minify: true,
  rollupOptions: { output: { entryFileNames: 'index.js' } },
} });
