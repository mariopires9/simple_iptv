/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the app under /<repo>/ — set in the deploy workflow (ADR-007).
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  // Workers as ES modules: allows dynamic import() inside tasks (FND-07).
  worker: { format: 'es' },
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
