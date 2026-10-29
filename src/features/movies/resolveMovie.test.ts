// VOD-02 AC3: the movie's stream descriptor (Xtream URL built in memory; M3U entry URL).
import { describe, expect, it, vi } from 'vitest';
import { VaultKeyLostError } from '@/core/crypto';
import type { Movie, Source } from '@/core/db';
import { containerOf, resolveMovieStream, xtreamMovieUrl } from './resolveMovie';

// Synthetic credentials only.
const PASS = 'synthetic/secret 42';

const xtream: Source = {
  id: 'x1',
  kind: 'xtream',
  name: 'Xtream',
  serverUrl: 'http://panel.example.test:8080/',
  username: 'demo',
  secretRef: 'xtream:x1',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};
const m3u: Source = { ...xtream, id: 'm1', kind: 'm3u-url' };
delete (m3u as Partial<Source>).secretRef;

const movie = (extra: Partial<Movie> = {}): Movie => ({
  key: 'x1:movie:2001',
  sourceId: 'x1',
  type: 'movie',
  externalId: '2001',
  name: 'Synthetic',
  order: 0,
  streamPath: '2001.mkv',
  ...extra,
});

const vault = {
  get: vi.fn((ref: string) => Promise.resolve(ref === 'xtream:x1' ? PASS : undefined)),
};

describe('resolveMovieStream — Xtream', () => {
  it('builds /movie/{user}/{pass}/{id}.{ext} with the container of the extension', async () => {
    expect(await resolveMovieStream(movie(), xtream, { vault })).toEqual({
      status: 'ok',
      descriptor: {
        url: `http://panel.example.test:8080/movie/demo/${encodeURIComponent(PASS)}/2001.mkv`,
        kind: 'vod',
        container: 'mkv',
      },
    });
  });

  it('without an extension in the catalogue, uses get_vod_info’s, else mp4', async () => {
    const bare = movie({ streamPath: '2001' });
    const withInfo = await resolveMovieStream(bare, xtream, { vault, infoExt: 'avi' });
    expect(withInfo).toMatchObject({
      descriptor: { url: expect.stringMatching(/\/2001\.avi$/), container: 'avi' },
    });
    const fallback = await resolveMovieStream(bare, xtream, { vault });
    expect(fallback).toMatchObject({
      descriptor: { url: expect.stringMatching(/\/2001\.mp4$/), container: 'mp4' },
    });
  });

  it('an unknown extension is passed through as an unknown container', async () => {
    const result = await resolveMovieStream(movie({ streamPath: '2001.xyz' }), xtream, { vault });
    expect(result).toMatchObject({ descriptor: { container: 'unknown', kind: 'vod' } });
  });

  it('missing or unreadable password → credentials', async () => {
    const noSecret = { ...xtream };
    delete noSecret.secretRef;
    expect(await resolveMovieStream(movie(), noSecret, { vault })).toEqual({
      status: 'credentials',
    });
    const lost = { get: () => Promise.reject(new VaultKeyLostError('xtream:x1', 'missing-key')) };
    expect(await resolveMovieStream(movie(), xtream, { vault: lost })).toEqual({
      status: 'credentials',
    });
    const empty = { get: () => Promise.resolve(undefined) };
    expect(await resolveMovieStream(movie(), xtream, { vault: empty })).toEqual({
      status: 'credentials',
    });
  });

  it('other vault errors propagate', async () => {
    const broken = { get: () => Promise.reject(new Error('db down')) };
    await expect(resolveMovieStream(movie(), xtream, { vault: broken })).rejects.toThrow('db down');
  });

  it('xtreamMovieUrl trims trailing slashes and encodes every segment', () => {
    expect(xtreamMovieUrl('https://h.test//', 'a b', 'p/w', '7', 'mp4')).toBe(
      'https://h.test/movie/a%20b/p%2Fw/7.mp4',
    );
  });
});

describe('resolveMovieStream — M3U', () => {
  const entry = (extra: Partial<Movie>) => movie({ sourceId: 'm1', streamPath: '', ...extra });

  it('uses the entry URL with its declared container', async () => {
    expect(
      await resolveMovieStream(
        entry({ streamUrl: 'https://cdn.example.test/v/film', container: 'hls' }),
        m3u,
      ),
    ).toEqual({
      status: 'ok',
      descriptor: { url: 'https://cdn.example.test/v/film', kind: 'vod', container: 'hls' },
    });
  });

  it('infers the container from the URL extension, else unknown', async () => {
    expect(
      await resolveMovieStream(entry({ streamUrl: 'https://cdn.example.test/f.MP4?x=1' }), m3u),
    ).toMatchObject({ descriptor: { container: 'mp4' } });
    expect(
      await resolveMovieStream(entry({ streamUrl: 'https://cdn.example.test/play' }), m3u),
    ).toMatchObject({ descriptor: { container: 'unknown' } });
  });

  it('DRM and DASH entries are never attempted', async () => {
    expect(
      await resolveMovieStream(entry({ streamUrl: 'https://c.test/a.mp4', drm: true }), m3u),
    ).toEqual({ status: 'unsupported', reason: 'drm' });
    expect(await resolveMovieStream(entry({ streamUrl: 'https://c.test/a.mpd' }), m3u)).toEqual({
      status: 'unsupported',
      reason: 'dash',
    });
    expect(
      await resolveMovieStream(entry({ streamUrl: 'https://c.test/a', container: 'dash' }), m3u),
    ).toEqual({ status: 'unsupported', reason: 'dash' });
  });

  it('an unusable address → unavailable', async () => {
    expect(await resolveMovieStream(entry({ streamUrl: 'javascript:alert(1)' }), m3u)).toEqual({
      status: 'unavailable',
    });
    expect(await resolveMovieStream(entry({}), m3u)).toEqual({ status: 'unavailable' });
  });
});

describe('containerOf', () => {
  it.each([
    ['mp4', 'mp4'],
    ['.MKV', 'mkv'],
    ['m3u8', 'hls'],
    ['mp3', 'mp4'],
    ['mpd', 'dash'],
    ['zzz', 'unknown'],
    [undefined, 'unknown'],
  ] as const)('%s → %s', (ext, container) => {
    expect(containerOf(ext)).toBe(container);
  });
});
