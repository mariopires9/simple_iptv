// @vitest-environment node
// PWA-01 (manifest, icons, iOS metadata) and PWA-02 (service worker config) — build configuration.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HtmlTagDescriptor, IndexHtmlTransformHook } from 'vite';
import { describe, expect, it } from 'vitest';
import { generateSW } from 'workbox-build';
import {
  ICONS,
  normaliseBase,
  PRECACHE_GLOBS,
  pwaManifest,
  pwaOptions,
  themeColorPlugin,
} from '../../build/pwa.ts';
// @ts-expect-error — plain .mjs script without type declarations
import { checkServiceWorker } from '../../scripts/check-dist-sw.mjs';
import { colors } from '../ui/theme/tokens';

const ROOT = join(import.meta.dirname, '..', '..');
const PUBLIC = join(ROOT, 'public');

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): [number, number] {
  const png = readFileSync(path);
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe('web app manifest (PWA-01 AC1)', () => {
  it.each(['/', '/simple_iptv/'])('start_url, scope and id follow the base %s', (base) => {
    const manifest = pwaManifest(base);
    expect(manifest).toMatchObject({ start_url: base, scope: base, id: base });
  });

  it('normalises the base like Vite (GitHub Pages sub-path)', () => {
    expect(normaliseBase('/simple_iptv')).toBe('/simple_iptv/');
    expect(normaliseBase('simple_iptv/')).toBe('/simple_iptv/');
    expect(pwaManifest('/simple_iptv').start_url).toBe('/simple_iptv/');
  });

  it('name, short_name, standalone display and colours from the design tokens', () => {
    const manifest = pwaManifest('/');
    expect(manifest.name).toBe('Simple IPTV');
    expect(manifest.short_name).toBe('Simple IPTV');
    expect(manifest.short_name?.length).toBeLessThanOrEqual(12);
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe(colors.dark.bg);
    expect(manifest.background_color).toBe(colors.dark.bg);
  });

  it('192 and 512 icons, "any" and "maskable", with relative paths to real PNGs of that size', () => {
    const icons = pwaManifest('/simple_iptv/').icons ?? [];
    for (const purpose of ['any', 'maskable']) {
      expect(icons.filter((i) => i.purpose === purpose).map((i) => i.sizes)).toEqual([
        '192x192',
        '512x512',
      ]);
    }
    for (const icon of icons) {
      expect(icon.src).not.toMatch(/^\/|^[a-z]+:/i);
      expect(icon.type).toBe('image/png');
      expect(pngSize(join(PUBLIC, icon.src)).join('x')).toBe(icon.sizes);
    }
  });

  it('screenshots for mobile (narrow) and desktop (wide) that match their files', () => {
    const screenshots = pwaManifest('/').screenshots ?? [];
    expect(screenshots.map((s) => s.form_factor).sort()).toEqual(['narrow', 'wide']);
    for (const shot of screenshots) {
      expect(pngSize(join(PUBLIC, shot.src)).join('x')).toBe(shot.sizes);
    }
  });

  it('icons stay small (committed binaries)', () => {
    for (const file of Object.values(ICONS)) {
      expect(readFileSync(join(PUBLIC, file)).length).toBeLessThan(16 * 1024);
    }
  });
});

describe('iOS metadata (PWA-01 AC2)', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

  it('apple-touch-icon (180×180) and apple-mobile-web-app-* metas in index.html', () => {
    expect(html).toContain(`<link rel="apple-touch-icon" href="/${ICONS.appleTouch}" />`);
    expect(pngSize(join(PUBLIC, ICONS.appleTouch))).toEqual([180, 180]);
    expect(html).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes" \/>/);
    expect(html).toMatch(/<meta name="apple-mobile-web-app-title" content="Simple IPTV" \/>/);
    expect(html).toMatch(
      /<meta name="apple-mobile-web-app-status-bar-style" content="\w[\w-]*" \/>/,
    );
  });

  it('theme-color metas come from the tokens (dark default, light on request)', async () => {
    const hook = themeColorPlugin().transformIndexHtml as IndexHtmlTransformHook;
    const tags = (await hook.call({} as never, '', {} as never)) as HtmlTagDescriptor[];
    expect(tags.map((tag) => tag.attrs)).toEqual([
      { name: 'theme-color', media: '(prefers-color-scheme: light)', content: colors.light.bg },
      { name: 'theme-color', content: colors.dark.bg },
    ]);
  });
});

describe('service worker configuration (PWA-02)', () => {
  it.each(['/', '/simple_iptv/'])('generateSW, prompt updates, scoped to the base %s', (base) => {
    const options = pwaOptions(base);
    expect(options).toMatchObject({
      strategies: 'generateSW',
      registerType: 'prompt',
      // Registration is done by src/app/pwa: no injected (inline) script, which the CSP forbids.
      injectRegister: false,
      scope: base,
      base,
      devOptions: { enabled: false },
    });
  });

  it('precaches the app shell: HTML, JS, CSS, fonts and icons (AC1)', () => {
    const glob = PRECACHE_GLOBS.join(' ');
    for (const ext of ['html', 'js', 'css', 'woff2', 'png', 'svg', 'webmanifest']) {
      expect(glob).toContain(ext);
    }
  });

  it('never caches other hosts: no runtime caching, no navigation fallback, no auto-activation (AC2)', () => {
    const { workbox } = pwaOptions('/simple_iptv/');
    expect(workbox?.runtimeCaching ?? []).toEqual([]);
    expect(workbox?.navigateFallback).toBeNull();
    expect(workbox?.skipWaiting).toBe(false);
    expect(workbox?.clientsClaim).toBe(false);
    expect(workbox?.additionalManifestEntries).toBeUndefined();
    expect(workbox?.importScripts).toBeUndefined();
  });

  it('the generated sw.js precaches only same-origin app files and routes nothing else (AC2)', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'pwa-sw-'));
    try {
      mkdirSync(join(dist, 'assets'));
      mkdirSync(join(dist, 'icons'));
      mkdirSync(join(dist, 'screenshots'));
      for (const file of [
        'index.html',
        'manifest.webmanifest',
        'assets/index-abc.js',
        'assets/index-abc.css',
        'assets/inter-latin.woff2',
        'icons/icon-192.png',
        'screenshots/wide.png',
      ]) {
        writeFileSync(join(dist, file), file);
      }
      const { workbox } = pwaOptions('/simple_iptv/');
      const swDest = join(dist, 'sw.js');
      await generateSW({ ...workbox, globDirectory: dist, swDest, mode: 'production' });
      const sw = readFileSync(swDest, 'utf8');
      expect(checkServiceWorker(sw)).toEqual([]);
      expect(sw).toContain('"index.html"');
      expect(sw).toContain('"assets/inter-latin.woff2"');
      expect(sw).not.toContain('screenshots/');
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
