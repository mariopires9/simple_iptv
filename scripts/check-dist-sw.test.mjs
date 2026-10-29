import { describe, expect, it } from 'vitest';
import {
  checkManifest,
  checkPrecacheUrl,
  checkServiceWorker,
  precacheUrls,
} from './check-dist-sw.mjs';

// Shaped like a minified Workbox generateSW output (registerType: 'prompt', no runtime caching).
const sw = (entries, extra = '') =>
  `if(!self.define){}define(["./workbox-d1213528"],function(s){"use strict";` +
  `self.addEventListener("message",s=>{s.data&&"SKIP_WAITING"===s.data.type&&self.skipWaiting()}),` +
  `s.precacheAndRoute([${entries.map((u) => `{url:"${u}",revision:"1"}`).join(',')}],{}),` +
  `s.cleanupOutdatedCaches()${extra}});`;

const SHELL = ['index.html', 'assets/index-abc.js', 'assets/index-abc.css', 'icons/icon-192.png'];

describe('check-dist-sw (PWA-02 AC2)', () => {
  it('accepts a precache of same-origin app files', () => {
    expect(precacheUrls(sw(SHELL))).toEqual(SHELL);
    expect(checkServiceWorker(sw(SHELL))).toEqual([]);
  });

  it.each([
    ['https://provider.example/get.php?username=u&password=p', 'not same-origin'],
    ['//cdn.example/x.js', 'not same-origin'],
    ['/simple_iptv/index.html', 'absolute path'],
    ['live/u/p/1.ts?token=x', 'query or fragment'],
    ['http://user:pass@host.example/x', 'not same-origin'],
    ['user@host/x', 'userinfo'],
    ['api/player_api.php/username=u', 'credential-like'],
    ['../outside.js', 'escapes the scope'],
  ])('rejects %s', (url, problem) => {
    expect(checkPrecacheUrl(url).join('\n')).toContain(problem);
    expect(checkServiceWorker(sw([...SHELL, url])).join('\n')).toContain(problem);
  });

  it('rejects runtime caching and navigation routes', () => {
    const runtime = ',s.registerRoute(/^https:\\/\\//,new s.NetworkFirst({cacheName:"api"}),"GET")';
    expect(checkServiceWorker(sw(SHELL, runtime)).join('\n')).toMatch(
      /runtime routing\/caching in sw\.js: registerRoute, NetworkFirst/,
    );
    const nav = ',s.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("index.html")))';
    expect(checkServiceWorker(sw(SHELL, nav)).join('\n')).toContain('NavigationRoute');
  });

  it('rejects an unconditional skipWaiting / clientsClaim (updates wait for the user, PWA-03)', () => {
    expect(checkServiceWorker(sw(SHELL, ',self.skipWaiting()')).join('\n')).toContain(
      'skipWaiting outside',
    );
    expect(checkServiceWorker(sw(SHELL, ',s.clientsClaim()')).join('\n')).toContain('clientsClaim');
  });

  it('rejects remote importScripts, a missing shell, missing files and an unrecognised sw.js', () => {
    expect(
      checkServiceWorker(sw(SHELL, ';importScripts("https://cdn.example/wb.js")')).join('\n'),
    ).toContain('importScripts from a URL');
    expect(checkServiceWorker(sw(['assets/a.js'])).join('\n')).toContain('index.html');
    expect(checkServiceWorker(sw(SHELL), { exists: (u) => u !== 'icons/icon-192.png' })).toEqual([
      'precached file missing from dist: icons/icon-192.png',
    ]);
    expect(checkServiceWorker('self.addEventListener("fetch",()=>{})')).toEqual([
      'precacheAndRoute([...]) not found in sw.js',
    ]);
  });

  it('checks the manifest base path and its image paths', () => {
    const manifest = {
      start_url: '/simple_iptv/',
      scope: '/simple_iptv/',
      id: '/simple_iptv/',
      display: 'standalone',
      icons: [{ src: 'icons/icon-192.png' }],
      screenshots: [{ src: 'screenshots/wide.png' }],
    };
    expect(checkManifest(manifest, '/simple_iptv/')).toEqual([]);
    expect(checkManifest(manifest, '/')).toHaveLength(3);
    expect(
      checkManifest({ ...manifest, icons: [{ src: '/icons/icon-192.png' }] }, '/simple_iptv/'),
    ).toEqual(['manifest image not relative: /icons/icon-192.png']);
    expect(
      checkManifest(manifest, '/simple_iptv/', { exists: (p) => p !== 'screenshots/wide.png' }),
    ).toEqual(['manifest image missing from dist: screenshots/wide.png']);
  });
});
