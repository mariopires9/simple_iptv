// PRX-01 AC1: personal proxy storage (token in the vault, address in the settings) and the
// per-list rewriters (off / streams / all). Synthetic hosts and tokens only.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import { settingsRepo, sourcesRepo, wipeAll, type Source } from '@/core/db';
import { clearSecrets, log, redact } from '@/core/log';
import type { RequestPurpose } from '@/core/net';
import {
  InvalidProxyConfigError,
  loadPersonalProxy,
  PROXY_TOKEN_REF,
  proxyRoutingOf,
  removePersonalProxy,
  rewritersForSource,
  savePersonalProxy,
} from './proxy';

const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
const BASE = 'https://pc.example.test';
const URL_ = 'http://panel.example.test:8080/live/u/p/1.ts';
const PURPOSES: RequestPurpose[] = ['api', 'playlist', 'stream', 'image', 'epg'];

const source = (id: string, proxy?: unknown): Source =>
  ({
    id,
    kind: 'xtream',
    name: id,
    prefs: proxy === undefined ? { liveFormat: 'auto' } : { liveFormat: 'auto', proxy },
    createdAt: 1,
    lastSyncStatus: 'ok',
    stats: { live: 0, movies: 0, series: 0 },
  }) as Source;

/** The purposes a rewriter sends to the proxy. */
const routed = (rewriter: { rewrite: (u: string, p: RequestPurpose) => string }) =>
  PURPOSES.filter((p) => rewriter.rewrite(URL_, p) !== URL_);

afterEach(async () => {
  vi.restoreAllMocks();
  clearSecrets();
  await wipeAll();
});

describe('personal proxy storage', () => {
  it('stores the token in the vault, never in the settings', async () => {
    await savePersonalProxy({ baseUrl: 'https://PC.example.test/', token: TOKEN });
    const setting = await settingsRepo.get('personalProxy');
    expect(setting).toEqual({ baseUrl: BASE });
    expect(JSON.stringify(setting)).not.toContain(TOKEN);
    expect(await credentialVault.get(PROXY_TOKEN_REF)).toBe(TOKEN);
    expect(await loadPersonalProxy()).toEqual({ baseUrl: BASE, token: TOKEN });
    expect(redact(TOKEN)).not.toContain(TOKEN);
  });

  it('rejects an invalid address or token without saving anything', async () => {
    await expect(
      savePersonalProxy({ baseUrl: 'http://pc.example.test', token: TOKEN }),
    ).rejects.toBeInstanceOf(InvalidProxyConfigError);
    await expect(savePersonalProxy({ baseUrl: BASE, token: 'short' })).rejects.toBeInstanceOf(
      InvalidProxyConfigError,
    );
    expect(await settingsRepo.get('personalProxy')).toBeUndefined();
    expect(await credentialVault.get(PROXY_TOKEN_REF)).toBeUndefined();
  });

  it('missing or corrupt config → undefined (with a warning)', async () => {
    const warn = vi.spyOn(log, 'warn');
    expect(await loadPersonalProxy()).toBeUndefined();
    await settingsRepo.set('personalProxy', { baseUrl: 'http://evil.example.test' });
    await credentialVault.put(PROXY_TOKEN_REF, TOKEN);
    expect(await loadPersonalProxy()).toBeUndefined();
    await settingsRepo.set('personalProxy', 42 as unknown as { baseUrl: string });
    expect(await loadPersonalProxy()).toBeUndefined();
    await settingsRepo.set('personalProxy', { baseUrl: BASE });
    await credentialVault.put(PROXY_TOKEN_REF, 'not a valid token');
    expect(await loadPersonalProxy()).toBeUndefined();
    await credentialVault.delete(PROXY_TOKEN_REF);
    expect(await loadPersonalProxy()).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('remove clears the address, the token and every list routing', async () => {
    await savePersonalProxy({ baseUrl: BASE, token: TOKEN });
    await sourcesRepo.put(source('a', 'all'));
    await sourcesRepo.put(source('b'));
    await removePersonalProxy();
    expect(await settingsRepo.get('personalProxy')).toBeUndefined();
    expect(await credentialVault.get(PROXY_TOKEN_REF)).toBeUndefined();
    expect((await sourcesRepo.get('a'))?.prefs).toEqual({ liveFormat: 'auto' });
    expect((await sourcesRepo.get('b'))?.prefs).toEqual({ liveFormat: 'auto' });
  });

  it('wipeAll ("delete all data") removes the proxy address and token', async () => {
    await savePersonalProxy({ baseUrl: BASE, token: TOKEN });
    await wipeAll();
    expect(await settingsRepo.get('personalProxy')).toBeUndefined();
    expect(await credentialVault.get(PROXY_TOKEN_REF)).toBeUndefined();
  });
});

describe('rewritersForSource', () => {
  const loadProxy = () => Promise.resolve({ baseUrl: BASE, token: TOKEN });

  it('off (absent or explicit) → direct, without reading the proxy', async () => {
    const load = vi.fn(loadProxy);
    for (const s of [source('a'), source('b', 'off')]) {
      const { playback, data } = await rewritersForSource(s, { loadProxy: load });
      expect(routed(playback)).toEqual([]);
      expect(routed(data)).toEqual([]);
    }
    expect(load).not.toHaveBeenCalled();
  });

  it('streams → the player routes streams and playlists; data stays direct', async () => {
    const { playback, data } = await rewritersForSource(source('a', 'streams'), { loadProxy });
    expect(routed(playback)).toEqual(['playlist', 'stream']);
    expect(routed(data)).toEqual([]);
    expect(playback.rewrite(URL_, 'stream').startsWith(`${BASE}/v1/${TOKEN}/u/`)).toBe(true);
  });

  it('all → data also routes api, playlist and epg; images never', async () => {
    const { playback, data } = await rewritersForSource(source('a', 'all'), { loadProxy });
    expect(routed(playback)).toEqual(['playlist', 'stream']);
    expect(routed(data)).toEqual(['api', 'playlist', 'epg']);
  });

  it('an unknown routing value, no proxy saved or a failing read → direct with a warning', async () => {
    const warn = vi.spyOn(log, 'warn');
    expect(proxyRoutingOf(source('a', 'everything'))).toBe('off');
    expect(proxyRoutingOf(source('a', 7))).toBe('off');
    for (const deps of [
      { loadProxy: () => Promise.resolve(undefined) },
      { loadProxy: () => Promise.reject(new Error('db')) },
    ]) {
      const { playback, data } = await rewritersForSource(source('a', 'all'), deps);
      expect(routed(playback)).toEqual([]);
      expect(routed(data)).toEqual([]);
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('reads the saved proxy by default', async () => {
    await savePersonalProxy({ baseUrl: BASE, token: TOKEN });
    const { playback } = await rewritersForSource(source('a', 'streams'));
    expect(routed(playback)).toEqual(['playlist', 'stream']);
  });
});
