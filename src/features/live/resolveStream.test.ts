// @vitest-environment node
// Node environment: real WebCrypto and structured clone of CryptoKey in fake-indexeddb, so the
// real credential vault stores and returns the (synthetic) password.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { credentialVault, VaultKeyLostError } from '@/core/crypto';
import {
  closeDatabase,
  openDatabase,
  sourcesRepo,
  type Channel,
  type LiveFormat,
  type Source,
} from '@/core/db';
import { clearLogBuffer, getLogEntries, log, toLogJson } from '@/core/log';
import { inferContainer, resolveStream, xtreamLiveDescriptor } from './resolveStream';

// Synthetic credentials only (never real ones).
const USER = 'demo user';
const PASS = 'synthetic-p@ss/word';
const SERVER = 'http://xtream.example:8080';

function xtreamSource(liveFormat: LiveFormat, secretRef: string | undefined = 'xtream:x1'): Source {
  return {
    id: 'x1',
    kind: 'xtream',
    name: 'Xtream',
    serverUrl: SERVER,
    username: USER,
    ...(secretRef !== undefined ? { secretRef } : {}),
    prefs: { liveFormat },
    createdAt: 1,
    lastSyncStatus: 'ok',
    stats: { live: 0, movies: 0, series: 0 },
  };
}

const m3uSource: Source = {
  id: 'm1',
  kind: 'm3u-url',
  name: 'M3U',
  prefs: { liveFormat: 'auto' },
  createdAt: 2,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};

function channel(streamPath: string, extra: Record<string, unknown> = {}): Channel {
  return {
    key: 'x1:live:1001',
    sourceId: 'x1',
    type: 'live',
    externalId: '1001',
    name: 'Channel',
    nameNorm: 'channel',
    order: 0,
    streamPath,
    ...extra,
  } as Channel;
}

const ENC = `${SERVER}/live/demo%20user/synthetic-p%40ss%2Fword/1001`;

beforeEach(async () => {
  await openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
  clearLogBuffer();
});

afterEach(async () => {
  await closeDatabase();
});

describe('xtreamLiveDescriptor (liveFormat × capabilities)', () => {
  const ts = { url: `${ENC}.ts`, kind: 'live', container: 'ts' };
  const hls = { url: `${ENC}.m3u8`, kind: 'live', container: 'hls' };
  it.each([
    ['ts', { mse: true, mms: false }, { ...ts, fallbacks: [hls] }],
    ['ts', { mse: false, mms: false }, { ...ts, fallbacks: [hls] }],
    ['m3u8', { mse: true, mms: false }, hls],
    ['m3u8', { mse: false, mms: false }, hls],
    ['auto', { mse: true, mms: false }, { ...ts, fallbacks: [hls] }],
    ['auto', { mse: false, mms: true }, { ...ts, fallbacks: [hls] }],
    ['auto', { mse: false, mms: false }, hls],
  ] as const)('%s with %o', (format, caps, expected) => {
    expect(xtreamLiveDescriptor(`${SERVER}/`, USER, PASS, '1001', format, caps)).toEqual(expected);
  });
});

describe('resolveStream — Xtream', () => {
  it('builds the URL in memory from the vault password, without logging it', async () => {
    const source = xtreamSource('auto');
    await sourcesRepo.put(source);
    await credentialVault.put('xtream:x1', PASS);
    const resolved = await resolveStream(channel('1001'), source, {
      capabilities: { mse: true, mms: false },
    });
    expect(resolved).toEqual({
      status: 'ok',
      requiredHeaders: false,
      descriptor: {
        url: `${ENC}.ts`,
        kind: 'live',
        container: 'ts',
        fallbacks: [{ url: `${ENC}.m3u8`, kind: 'live', container: 'hls' }],
      },
    });
    // Even if something logged the URL, the vault registered the password for redaction; and
    // resolveStream itself logs nothing that contains it.
    log.info('probe', { url: resolved.status === 'ok' ? resolved.descriptor.url : '' });
    const buffer = toLogJson(getLogEntries());
    expect(buffer).not.toContain(PASS);
    expect(buffer).not.toContain(encodeURIComponent(PASS));
  });

  it('a channel id stored with an extension still resolves to the preferred format', async () => {
    const resolved = await resolveStream(channel('1001.ts'), xtreamSource('m3u8'), {
      vault: { get: () => Promise.resolve(PASS) },
    });
    expect(resolved.status === 'ok' && resolved.descriptor.url).toBe(`${ENC}.m3u8`);
  });

  it('a lost vault key asks for the password again', async () => {
    const resolved = await resolveStream(channel('1001'), xtreamSource('auto'), {
      vault: { get: () => Promise.reject(new VaultKeyLostError('xtream:x1', 'missing-key')) },
    });
    expect(resolved).toEqual({ status: 'credentials' });
  });

  it('a missing secret (or secretRef) asks for the password again', async () => {
    const none = { get: () => Promise.resolve(undefined) };
    expect(await resolveStream(channel('1001'), xtreamSource('auto'), { vault: none })).toEqual({
      status: 'credentials',
    });
    expect(
      await resolveStream(channel('1001'), xtreamSource('auto', undefined), { vault: none }),
    ).toEqual({ status: 'credentials' });
  });

  it('other vault errors propagate', async () => {
    await expect(
      resolveStream(channel('1001'), xtreamSource('auto'), {
        vault: { get: () => Promise.reject(new Error('db closed')) },
      }),
    ).rejects.toThrow('db closed');
  });
});

describe('resolveStream — M3U', () => {
  it('uses streamUrl with its declared container', async () => {
    const resolved = await resolveStream(
      channel('ignored', { streamUrl: 'https://cdn.example/live/a', container: 'm3u8' }),
      m3uSource,
    );
    expect(resolved).toEqual({
      status: 'ok',
      requiredHeaders: false,
      descriptor: { url: 'https://cdn.example/live/a', kind: 'live', container: 'hls' },
    });
  });

  it('falls back to streamPath and infers the container from the extension', async () => {
    const resolved = await resolveStream(channel('https://cdn.example/a/index.m3u8'), m3uSource);
    expect(resolved.status === 'ok' && resolved.descriptor.container).toBe('hls');
  });

  it.each([
    [{ drm: { system: 'widevine' } }, 'drm'],
    [{ drm: true, container: 'hls' }, 'drm'],
    [{ container: 'dash' }, 'dash'],
    [{ streamUrl: 'https://cdn.example/manifest.mpd' }, 'dash'],
  ])('never attempts DRM/DASH entries (%o)', async (extra, reason) => {
    expect(await resolveStream(channel('https://cdn.example/a.ts', extra), m3uSource)).toEqual({
      status: 'unsupported',
      reason,
    });
  });

  it('flags entries with required headers (played anyway)', async () => {
    const resolved = await resolveStream(
      channel('https://cdn.example/a.ts', {
        requiredHeaders: { Referer: 'https://site.example/' },
      }),
      m3uSource,
    );
    expect(resolved.status === 'ok' && resolved.requiredHeaders).toBe(true);
  });

  it('an entry without a usable http(s) URL is unavailable', async () => {
    expect(await resolveStream(channel('1.ts'), m3uSource)).toEqual({ status: 'unavailable' });
    expect(await resolveStream(channel('ftp://h/a.ts'), m3uSource)).toEqual({
      status: 'unavailable',
    });
  });

  it.each([
    ['http://h/123', 'ts'],
    ['http://h/a.TS', 'ts'],
    ['http://h/a.mp4', 'mp4'],
    ['http://h/a.php', 'unknown'],
  ])('infers %s → %s', (url, container) => {
    expect(inferContainer(new URL(url))).toBe(container);
  });
});
