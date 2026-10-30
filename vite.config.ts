/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { cspPlugin } from './build/csp.ts';
import { inlineCssPlugin } from './build/inlineCss.ts';
import { licensesPlugin } from './build/licenses.ts';
import { pwaOptions, themeColorPlugin } from './build/pwa.ts';

// GitHub Pages serves the app under /<repo>/ — set in the deploy workflow (ADR-007).
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  // PWA-01/PWA-02: manifest + generateSW precache of the app shell (rules in build/pwa.ts).
  // QA-04: the entry stylesheet is inlined into index.html (build/inlineCss.ts).
  plugins: [
    react(),
    inlineCssPlugin(),
    cspPlugin(),
    licensesPlugin(),
    themeColorPlugin(),
    VitePWA(pwaOptions(base)),
  ],
  // Workers as ES modules: allows dynamic import() inside tasks (FND-07).
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks for libraries every page needs, so an app update does not
        // re-download them. A group captures every matching module, including ones only lazy
        // screens use, so only list libraries that are entirely needed at startup: no catch-all
        // `node_modules` group (would pull hls.js, mpegts.js, Dexie in) and no `@mui` group (would
        // pull every MUI component used by any lazy screen into the initial load).
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 3,
            },
            { name: 'router', test: /node_modules[\\/]react-router[\\/]/, priority: 2 },
            // QA-04: the rest of the start-up graph (app, i18n, MUI core) in one chunk instead of a
            // dozen small shared ones: each request is a round trip on a slow mobile connection.
            // `$initial` only captures modules statically reachable from the entry, which load
            // at start-up anyway; lazy-only modules keep their own chunks.
            { name: 'startup', tags: ['$initial'], priority: 1 },
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
    // Integration tests (fake IndexedDB paging, whole-app boot, ESLint API) run in parallel under
    // coverage on CI; 15 s per test is a ceiling, well above the 5 s async-wait ceiling in setup.ts.
    testTimeout: 15_000,
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs', 'proxy/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.claude/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**', 'proxy/**'],
      reporter: ['text-summary', 'html'],
    },
  },
});
