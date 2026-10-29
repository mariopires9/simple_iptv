import type { Plugin } from 'vite';
import type { ManifestOptions, VitePWAOptions } from 'vite-plugin-pwa';
import { colors } from '../src/ui/theme/tokens.ts';

/**
 * PWA configuration (PWA-01 manifest, PWA-02 service worker), kept out of vite.config.ts so it can
 * be unit-tested (src/test/pwaConfig.test.ts).
 *
 * Service worker rules (docs/SECURITY.md, PWA-02 AC2):
 * - It precaches the app shell only: files emitted by the build into dist/ (same origin, under the
 *   base path). Nothing else ever enters Cache Storage.
 * - No `runtimeCaching`: provider APIs, streams, logos and EPG live on other hosts and their URLs
 *   may carry credentials, so the service worker never intercepts or stores them. Workbox only
 *   answers requests for precached URLs; every other request goes straight to the network.
 * - No `navigateFallback`: the app uses a HashRouter (ADR-007), so every navigation is a request
 *   for the base path itself, which the precache already answers (`directoryIndex`).
 * - `registerType: 'prompt'`: a new version waits until the user accepts it (PWA-03), so an update
 *   never reloads the page during playback. No `skipWaiting`/`clientsClaim`.
 * - `injectRegister: false`: registration is done by src/app/pwa (production only, lazily loaded);
 *   an injected inline script would also break the CSP (`script-src 'self'`).
 */

/** Normalises a Vite `base` to the absolute form used by the manifest and the SW scope. */
export function normaliseBase(base: string): string {
  const withLeading = base.startsWith('/') ? base : `/${base}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export const APP_NAME = 'Simple IPTV';

/** Files in public/ that are part of the app shell and its install surface. */
export const ICONS = {
  any192: 'icons/icon-192.png',
  any512: 'icons/icon-512.png',
  maskable192: 'icons/icon-maskable-192.png',
  maskable512: 'icons/icon-maskable-512.png',
  appleTouch: 'icons/apple-touch-icon.png',
  favicon: 'icons/icon.svg',
} as const;

/**
 * Web app manifest. Icon and screenshot paths are relative: browsers resolve them against the
 * manifest URL (`<base>manifest.webmanifest`), so they follow the base path.
 */
export function pwaManifest(base: string): Partial<ManifestOptions> {
  const root = normaliseBase(base);
  return {
    id: root,
    name: APP_NAME,
    short_name: APP_NAME,
    description: 'IPTV player for your own lists (M3U and Xtream Codes). No account, no tracking.',
    lang: 'en',
    dir: 'ltr',
    start_url: root,
    scope: root,
    display: 'standalone',
    orientation: 'any',
    // Dark is the default theme (src/ui/theme/ThemeModeProvider.tsx).
    theme_color: colors.dark.bg,
    background_color: colors.dark.bg,
    categories: ['entertainment', 'video'],
    icons: [
      { src: ICONS.any192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: ICONS.any512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: ICONS.maskable192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: ICONS.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [
      {
        src: 'screenshots/narrow.png',
        sizes: '540x960',
        type: 'image/png',
        form_factor: 'narrow',
        label: APP_NAME,
      },
      {
        src: 'screenshots/wide.png',
        sizes: '1280x720',
        type: 'image/png',
        form_factor: 'wide',
        label: APP_NAME,
      },
    ],
  };
}

/** Extensions of the build output that make up the app shell (PWA-02 AC1). */
export const PRECACHE_GLOBS = ['**/*.{html,js,css,woff2,png,svg,webmanifest}'];

/** vite-plugin-pwa options (generateSW). */
export function pwaOptions(base: string): Partial<VitePWAOptions> {
  const root = normaliseBase(base);
  return {
    strategies: 'generateSW',
    registerType: 'prompt',
    injectRegister: false,
    filename: 'sw.js',
    manifestFilename: 'manifest.webmanifest',
    base: root,
    scope: root,
    // The icons are already matched by PRECACHE_GLOBS (avoids duplicate precache entries).
    includeManifestIcons: false,
    manifest: pwaManifest(root),
    devOptions: { enabled: false },
    workbox: {
      globPatterns: PRECACHE_GLOBS,
      // Screenshots are only read by the install UI, from the network.
      globIgnores: ['**/node_modules/**', 'screenshots/**'],
      // hls.js (≈ 575 KB raw, ADR-017) must fit: precached so a later first play is instant.
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      navigateFallback: null,
      runtimeCaching: [],
      skipWaiting: false,
      clientsClaim: false,
      cleanupOutdatedCaches: true,
      // Nothing in the precache uses query parameters; never treat one as an alias of a file.
      ignoreURLParametersMatching: [/.^/],
      sourcemap: false,
    },
  };
}

/**
 * Adds `theme-color` metas (dark/light from the design tokens) to index.html. Literal colours only
 * live in tokens.ts (FND-03), so they are injected here instead of being written in index.html.
 */
export function themeColorPlugin(): Plugin {
  return {
    name: 'simple-iptv:theme-color',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: {
          name: 'theme-color',
          media: '(prefers-color-scheme: light)',
          content: colors.light.bg,
        },
        injectTo: 'head',
      },
      {
        tag: 'meta',
        attrs: { name: 'theme-color', content: colors.dark.bg },
        injectTo: 'head',
      },
    ],
  };
}
