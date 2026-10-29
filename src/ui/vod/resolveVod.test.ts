// SER-03 / VOD-02: shared VOD stream resolution — Xtream URLs built in memory (movie and series
// paths), never logged; M3U entries with their own URL; DRM/DASH never attempted.
import { describe, expect, it, vi } from 'vitest';
import { VaultKeyLostError } from '@/core/crypto';
import type { Source } from '@/core/db';
import { clearLogBuffer, getLogEntries, log } from '@/core/log';
import { resolveM3uVod, resolveXtreamVod, sourceIdentity, xtreamVodUrl } from './resolveVod';

// Synthetic credentials only.
const PASS = 'p@ss/w0rd?';
const source: Source = {
  id: 'x1',
  kind: 'xtream',
  name: 'X',
  serverUrl: 'http://panel.example.test:8080/',
  username: 'demo user',
  secretRef: 'xtream:x1',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};
const vault = { get: vi.fn(async () => PASS) };

describe('resolveXtreamVod', () => {
  it('series: `${base}/series/${user}/${pass}/${id}.${ext}` with encoded parts', async () => {
    const out = await resolveXtreamVod('series', source, '40102', 'mkv', { vault });
    expect(out).toEqual({
      status: 'ok',
      descriptor: {
        url: 'http://panel.example.test:8080/series/demo%20user/p%40ss%2Fw0rd%3F/40102.mkv',
        kind: 'vod',
        container: 'mkv',
      },
    });
    expect(xtreamVodUrl('movie', 'http://h/', 'u', 'p', '1', 'mp4')).toBe(
      'http://h/movie/u/p/1.mp4',
    );
  });

  it('never logs the URL or the password', async () => {
    clearLogBuffer();
    const out = await resolveXtreamVod('series', source, '1', 'mp4', { vault });
    // Even if a caller logged the descriptor, the password is redacted.
    log.info('resolved', { url: out.status === 'ok' ? out.descriptor.url : '' });
    expect(JSON.stringify(getLogEntries())).not.toContain(PASS);
    expect(JSON.stringify(getLogEntries())).not.toContain(encodeURIComponent(PASS));
  });

  it('credentials / unavailable / dash', async () => {
    const lost = {
      get: vi.fn(async () => Promise.reject(new VaultKeyLostError('xtream:x1', 'missing-key'))),
    };
    expect(await resolveXtreamVod('series', source, '1', 'mp4', { vault: lost })).toEqual({
      status: 'credentials',
    });
    expect(
      await resolveXtreamVod('series', source, '1', 'mp4', {
        vault: { get: async (_ref: string) => undefined },
      }),
    ).toEqual({ status: 'credentials' });
    const noSecret: Source = { ...source };
    delete noSecret.secretRef;
    expect(await resolveXtreamVod('series', noSecret, '1', 'mp4', { vault })).toEqual({
      status: 'credentials',
    });
    expect(await resolveXtreamVod('series', source, '', 'mp4', { vault })).toEqual({
      status: 'unavailable',
    });
    expect(await resolveXtreamVod('series', source, '1', 'mpd', { vault })).toEqual({
      status: 'unsupported',
      reason: 'dash',
    });
  });
});

describe('resolveM3uVod', () => {
  it('own URL, declared or inferred container; DRM and bad URLs refused', () => {
    expect(resolveM3uVod({ streamUrl: 'https://cdn.example.test/e1.mkv' })).toEqual({
      status: 'ok',
      descriptor: { url: 'https://cdn.example.test/e1.mkv', kind: 'vod', container: 'mkv' },
    });
    expect(
      resolveM3uVod({ streamUrl: 'https://cdn.example.test/e1', container: 'mp4' }),
    ).toMatchObject({
      descriptor: { container: 'mp4' },
    });
    expect(resolveM3uVod({ streamUrl: 'https://cdn.example.test/e1.mp4', drm: true })).toEqual({
      status: 'unsupported',
      reason: 'drm',
    });
    expect(resolveM3uVod({ streamUrl: 'javascript:alert(1)' })).toEqual({ status: 'unavailable' });
    expect(resolveM3uVod({})).toEqual({ status: 'unavailable' });
  });
});

describe('sourceIdentity', () => {
  it('changes with the account fields and the last sync', () => {
    const base = sourceIdentity(source);
    expect(sourceIdentity({ ...source, lastSyncAt: 5 })).not.toBe(base);
    expect(sourceIdentity({ ...source, secretRef: 'other' })).not.toBe(base);
    expect(sourceIdentity({ ...source, name: 'Renamed' })).toBe(base);
    expect(base).not.toContain(PASS);
  });
});
