// Checks the built service worker and web app manifest against PWA-02 AC2 (docs/SECURITY.md):
// only same-origin app-shell files may enter Cache Storage, so no URL with credentials ever can.
// - dist/sw.js precaches only relative paths of files that exist in dist/ (no scheme, no host, no
//   query string, no fragment, no userinfo, no credential-looking parameters), and never the lazy
//   playback engines (hls.js, mpegts.js: loaded on first use, PLY-01 AC2);
// - dist/sw.js registers no runtime route or caching strategy (no `runtimeCaching`, no
//   navigation route) and never calls `skipWaiting` on its own (only on the PWA-03 prompt message);
// - dist/manifest.webmanifest has start_url/scope/id equal to the base path and relative icons.
// Usage: node scripts/check-dist-sw.mjs [distDir] [base]   (defaults: dist, $VITE_BASE or "/")
// No dependencies on purpose: it runs right after `vite build` (npm run build). The base path and
// engine globs come from build/pwa.ts (Node ≥ 22.18 strips the TypeScript types on import).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE_CHUNK_GLOBS, normaliseBase } from '../build/pwa.ts';

/** `assets/hls-*.js` → a RegExp matching that path (`*` = any characters except `/`). */
const globToRegExp = (glob) =>
  new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')}$`);
const ENGINE_CHUNKS = ENGINE_CHUNK_GLOBS.map(globToRegExp);

/** Precache entries of a generated (minified) Workbox sw.js. */
export function precacheUrls(sw) {
  const call = sw.match(/precacheAndRoute\(\s*\[([\s\S]*?)\]\s*,/);
  if (!call) return undefined;
  return [...call[1].matchAll(/url\s*:\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((m) => m[2]);
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const CREDENTIAL_PARAM = /(?:^|[/?&#._-])(?:user(?:name)?|pass(?:word)?|token|auth|key|secret)=/i;

/** Problems with one precache URL (empty when it is a plain relative app file). */
export function checkPrecacheUrl(url) {
  const problems = [];
  if (SCHEME.test(url) || url.startsWith('//')) problems.push(`not same-origin relative: ${url}`);
  if (url.startsWith('/')) problems.push(`absolute path (must be relative to the SW): ${url}`);
  if (url.includes('?') || url.includes('#')) problems.push(`query or fragment in URL: ${url}`);
  if (url.includes('@')) problems.push(`userinfo-like "@" in URL: ${url}`);
  if (CREDENTIAL_PARAM.test(url)) problems.push(`credential-like parameter in URL: ${url}`);
  if (url.split('/').includes('..')) problems.push(`path escapes the scope: ${url}`);
  return problems;
}

/** Workbox routing/strategy names that only appear in sw.js if something is cached at runtime. */
const RUNTIME_ROUTING =
  /\b(registerRoute|NavigationRoute|CacheFirst|CacheOnly|NetworkFirst|NetworkOnly|StaleWhileRevalidate|clientsClaim)\b/g;
/** The `registerType: 'prompt'` handler: skipWaiting only when the page asks for it (PWA-03). */
const SKIP_WAITING_ON_MESSAGE =
  /addEventListener\(\s*["']message["'][\s\S]{0,120}?["']SKIP_WAITING["'][\s\S]{0,60}?skipWaiting\(\)/;

/** Problems in a generated sw.js (empty array when it satisfies PWA-02 AC2). */
export function checkServiceWorker(sw, { exists = () => true } = {}) {
  const problems = [];
  const urls = precacheUrls(sw);
  if (urls === undefined) return ['precacheAndRoute([...]) not found in sw.js'];
  if (urls.length === 0) problems.push('empty precache list');
  for (const url of urls) {
    problems.push(...checkPrecacheUrl(url));
    if (ENGINE_CHUNKS.some((pattern) => pattern.test(url))) {
      problems.push(`playback engine precached (load on first use only): ${url}`);
    }
    if (!exists(url)) problems.push(`precached file missing from dist: ${url}`);
  }
  if (!urls.includes('index.html')) problems.push('index.html (app shell) is not precached');
  const routing = [...new Set([...sw.matchAll(RUNTIME_ROUTING)].map((m) => m[1]))];
  if (routing.length > 0) problems.push(`runtime routing/caching in sw.js: ${routing.join(', ')}`);
  if (/importScripts\(\s*["'`](?:https?:)?\/\//.test(sw)) problems.push('importScripts from a URL');
  if (sw.replace(SKIP_WAITING_ON_MESSAGE, '').includes('skipWaiting')) {
    problems.push('skipWaiting outside the SKIP_WAITING message handler (PWA-03 prompt)');
  }
  return problems;
}

/** Problems in the built web app manifest for this base path. */
export function checkManifest(manifest, base, { exists = () => true } = {}) {
  const problems = [];
  for (const key of ['start_url', 'scope', 'id']) {
    if (manifest[key] !== base)
      problems.push(`manifest ${key} is "${manifest[key]}", expected "${base}"`);
  }
  if (manifest.display !== 'standalone') problems.push('manifest display is not standalone');
  const images = [...(manifest.icons ?? []), ...(manifest.screenshots ?? [])];
  for (const { src } of images) {
    if (SCHEME.test(src) || src.startsWith('/'))
      problems.push(`manifest image not relative: ${src}`);
    else if (!exists(src)) problems.push(`manifest image missing from dist: ${src}`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dist = process.argv[2] ?? 'dist';
  const base = normaliseBase(process.argv[3] ?? process.env.VITE_BASE ?? '/');
  const exists = (path) => existsSync(join(dist, path));
  const problems = [
    ...checkServiceWorker(readFileSync(join(dist, 'sw.js'), 'utf8'), { exists }).map(
      (p) => `sw.js: ${p}`,
    ),
    ...checkManifest(JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8')), base, {
      exists,
    }).map((p) => `manifest.webmanifest: ${p}`),
  ];
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`${dist}/${p}\n`);
    process.exit(1);
  }
  const count = precacheUrls(readFileSync(join(dist, 'sw.js'), 'utf8')).length;
  process.stdout.write(
    `${dist}: service worker precaches ${count} same-origin files only; manifest base ${base} ok.\n`,
  );
}
