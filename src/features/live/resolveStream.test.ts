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
import {
  inferContainer,
  liveDeviceClass,
  preferContainer,
  resolveStream,
  xtreamLiveDescriptor,
} from './resolveStream';

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
    // PLY-07: HLS first, TS as the fallback only when mpegts.js can play it.
    ['m3u8', { mse: true, mms: false }, { ...hls, fallbacks: [ts] }],
    ['m3u8', { mse: false, mms: true }, { ...hls, fallbacks: [ts] }],
    ['m3u8', { mse: false, mms: false }, hls],
    ['auto', { mse: true, mms: false }, { ...ts, fallbacks: [hls] }],
    // PLY-07: iPhone (ManagedMediaSource, no MSE) and Safari → HLS first (native), TS fallback.
    ['auto', { mse: false, mms: true }, { ...hls, fallbacks: [ts] }],
    [
      'auto',
      { mse: true, mms: false, nativeHls: true, isSafari: true },
      { ...hls, fallbacks: [ts] },
    ],
    // Recent Chrome reports native HLS too, but keeps TS first.
    [
      'auto',
      { mse: true, mms: false, nativeHls: true, isSafari: false },
      { ...ts, fallbacks: [hls] },
    ],
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
        externalUrl: `${ENC}.ts`,
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
      capabilities: { mse: true, mms: false },
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
    ['http://h/123', false, { container: 'ts', guessed: true }],
    ['http://h/a.TS', false, { container: 'ts', guessed: false }],
    ['http://h/a.mp4', false, { container: 'mp4', guessed: false }],
    ['http://h/a.php', false, { container: 'ts', guessed: true }],
    ['http://h/a.mp3', false, { container: 'mp4', guessed: false }],
    // Radio entries are never guessed as MPEG-TS.
    ['http://h/radio', true, { container: 'mp4', guessed: false }],
    ['http://h/radio.ts', true, { container: 'mp4', guessed: false }],
    ['http://h/radio.m3u8', true, { container: 'hls', guessed: false }],
  ] as const)('infers %s (audioOnly %s) → %o', (url, audioOnly, expected) => {
    expect(inferContainer(new URL(url), audioOnly)).toEqual(expected);
  });

  it.each(['mp3', 'aac', 'ogg', 'flac', 'MP3'])(
    'a declared audio container (%s) plays natively, whatever the URL says',
    async (container) => {
      const resolved = await resolveStream(
        channel('https://radio.example/stream', { container, audioOnly: true }),
        m3uSource,
      );
      expect(resolved.status === 'ok' && resolved.descriptor).toEqual({
        url: 'https://radio.example/stream',
        kind: 'live',
        container: 'mp4',
      });
    },
  );

  it.each(['hls', 'ts', 'mp4', 'mkv', 'webm', 'flv', 'mov'])(
    'honours any declared player container (%s), without a fallback',
    async (container) => {
      const resolved = await resolveStream(
        channel('https://cdn.example/x', { container }),
        m3uSource,
      );
      expect(resolved.status === 'ok' && resolved.descriptor).toEqual({
        url: 'https://cdn.example/x',
        kind: 'live',
        container,
      });
    },
  );

  it('a radio entry without extension is native audio, not MPEG-TS', async () => {
    const resolved = await resolveStream(
      channel('https://radio.example/live', { audioOnly: true }),
      m3uSource,
    );
    expect(resolved.status === 'ok' && resolved.descriptor).toEqual({
      url: 'https://radio.example/live',
      kind: 'live',
      container: 'mp4',
    });
  });

  it('a live URL without extension is TS first, with an HLS fallback on the same URL', async () => {
    const resolved = await resolveStream(channel('http://iptv.example/u/p/123'), m3uSource, {
      capabilities: { mse: true, mms: false },
    });
    expect(resolved.status === 'ok' && resolved.descriptor).toEqual({
      url: 'http://iptv.example/u/p/123',
      kind: 'live',
      container: 'ts',
      fallbacks: [{ url: 'http://iptv.example/u/p/123', kind: 'live', container: 'hls' }],
    });
    // A known extension is not a guess: no fallback.
    const known = await resolveStream(channel('http://iptv.example/a.m3u8'), m3uSource);
    expect(known.status === 'ok' && known.descriptor.fallbacks).toBeUndefined();
  });
});

describe('PLY-07 — learned format and fallbacks', () => {
  const vault = { get: () => Promise.resolve(PASS) };
  const mse = { mse: true, mms: false };

  it('a learned container goes first; the other stays as the fallback (beats "auto")', async () => {
    const resolved = await resolveStream(channel('1001'), xtreamSource('auto'), {
      vault,
      capabilities: mse,
      learned: (key) => (key === 'x1:live:1001' ? 'hls' : undefined),
    });
    expect(resolved.status === 'ok' && resolved.descriptor).toEqual({
      url: `${ENC}.m3u8`,
      kind: 'live',
      container: 'hls',
      fallbacks: [{ url: `${ENC}.ts`, kind: 'live', container: 'ts' }],
    });
  });

  it('without memory the explicit preference is the first try; with memory, memory wins', async () => {
    const none = await resolveStream(channel('1001'), xtreamSource('m3u8'), {
      vault,
      capabilities: mse,
      learned: () => undefined,
    });
    expect(none.status === 'ok' && none.descriptor.container).toBe('hls');
    const learned = await resolveStream(channel('1001'), xtreamSource('m3u8'), {
      vault,
      capabilities: mse,
      learned: () => 'ts',
    });
    expect(learned.status === 'ok' && learned.descriptor).toEqual({
      url: `${ENC}.ts`,
      kind: 'live',
      container: 'ts',
      fallbacks: [{ url: `${ENC}.m3u8`, kind: 'live', container: 'hls' }],
    });
  });

  it.each([
    ['http://iptv.example/live/u/p/123.ts', 'http://iptv.example/live/u/p/123.m3u8', 'hls'],
    ['http://iptv.example/live/u/p/123.m3u8', 'http://iptv.example/live/u/p/123.ts', 'ts'],
    ['http://iptv.example:8080/u/p/123.ts?x=1', 'http://iptv.example:8080/u/p/123.m3u8?x=1', 'hls'],
    ['http://iptv.example/u/p/123.m3u8', 'http://iptv.example/u/p/123.ts', 'ts'],
  ] as const)(
    'an Xtream-style M3U URL %s gets %s as the fallback',
    async (url, other, container) => {
      const resolved = await resolveStream(channel(url), m3uSource, {
        capabilities: mse,
        learned: () => undefined,
      });
      expect(resolved.status === 'ok' && resolved.descriptor.fallbacks).toEqual([
        { url: other, kind: 'live', container },
      ]);
    },
  );

  it.each([
    'https://cdn.example/a/index.m3u8',
    'https://cdn.example/a/b/c/123.ts',
    'https://cdn.example/live/u/p/name.ts',
    'https://cdn.example/live/u/p/123.mp4',
  ])('a non-Xtream M3U URL (%s) gets no invented fallback', async (url) => {
    const resolved = await resolveStream(channel(url), m3uSource, { learned: () => 'hls' });
    expect(resolved.status === 'ok' && resolved.descriptor.fallbacks).toBeUndefined();
    expect(resolved.status === 'ok' && resolved.descriptor.url).toBe(url);
  });

  it('a learned container reorders an Xtream-style M3U entry', async () => {
    const resolved = await resolveStream(channel('http://iptv.example/live/u/p/9.ts'), m3uSource, {
      capabilities: mse,
      learned: () => 'hls',
    });
    expect(resolved.status === 'ok' && resolved.descriptor).toEqual({
      url: 'http://iptv.example/live/u/p/9.m3u8',
      kind: 'live',
      container: 'hls',
      fallbacks: [{ url: 'http://iptv.example/live/u/p/9.ts', kind: 'live', container: 'ts' }],
    });
  });

  it('the memory is looked up for this device class', async () => {
    const asked: string[] = [];
    await resolveStream(channel('1001'), xtreamSource('auto'), {
      vault,
      capabilities: { mse: false, mms: true },
      learned: (key, deviceClass) => {
        asked.push(`${deviceClass} ${key}`);
        return undefined;
      },
    });
    expect(asked).toEqual(['native-hls x1:live:1001']);
  });

  it('a guessed M3U entry on a native-HLS device tries HLS first', async () => {
    const resolved = await resolveStream(channel('http://iptv.example/u/p/123'), m3uSource, {
      capabilities: { mse: false, mms: true },
      learned: () => undefined,
    });
    expect(resolved.status === 'ok' && resolved.descriptor).toEqual({
      url: 'http://iptv.example/u/p/123',
      kind: 'live',
      container: 'hls',
      fallbacks: [{ url: 'http://iptv.example/u/p/123', kind: 'live', container: 'ts' }],
    });
  });

  it.each([
    [{ mse: false, mms: true }, 'native-hls'],
    [{ mse: true, mms: false, nativeHls: true, isSafari: true }, 'native-hls'],
    [{ mse: true, mms: false, nativeHls: true, isSafari: false }, 'mse'],
    [{ mse: true, mms: true }, 'mse'],
  ] as const)('device class of %o is %s', (caps, expected) => {
    expect(liveDeviceClass(caps)).toBe(expected);
  });

  it('preferContainer leaves a descriptor alone when nothing matches', () => {
    const d = { url: 'u', kind: 'live', container: 'ts' } as const;
    expect(preferContainer(d, 'hls')).toBe(d);
    expect(preferContainer(d, undefined)).toBe(d);
  });
});
