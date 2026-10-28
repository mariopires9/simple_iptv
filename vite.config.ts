/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cspPlugin } from './build/csp.ts';

// GitHub Pages serves the app under /<repo>/ — set in the deploy workflow (ADR-007).
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react(), cspPlugin()],
  // Workers as ES modules: allows dynamic import() inside tasks (FND-07).
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks for libraries every page needs, so an app update does not
        // re-download them. Only list eagerly used libraries: a catch-all `node_modules` group
        // would pull lazily loaded ones (hls.js, mpegts.js, Dexie) into the initial load.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 3,
            },
            { name: 'router', test: /node_modules[\\/]react-router[\\/]/, priority: 2 },
            { name: 'mui', test: /node_modules[\\/](@mui|@emotion|@popperjs)[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    exclude: ['**/node_modules/**', '.claude/**'],
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary', 'html'] },
  },
});
