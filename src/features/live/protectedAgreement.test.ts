// UX-07: the "Protected" mark (`isProtectedStream`, core/db) and the players' refusal
// (`resolveStream` for Live, `resolveM3uVod` for movies/episodes) agree on every case.
import { describe, expect, it } from 'vitest';
import { isProtectedStream, type Channel, type Source } from '@/core/db';
import { resolveM3uVod } from '@/ui/vod/resolveVod';
import { resolveStream } from './resolveStream';

const source: Source = {
  id: 'm',
  kind: 'm3u-url',
  name: 'List',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};

const CASES: { name: string; streamUrl: string; container?: string; drm?: boolean }[] = [
  { name: 'declared dash', streamUrl: 'https://cdn.example.test/a.m3u8', container: 'dash' },
  { name: 'mpd path', streamUrl: 'https://cdn.example.test/live/a.mpd' },
  { name: 'mpd path with a query', streamUrl: 'https://cdn.example.test/a.MPD?token=1' },
  { name: 'mpd only in the query', streamUrl: 'https://cdn.example.test/play.php?src=feed.mpd' },
  {
    name: 'legacy container, mpd path',
    streamUrl: 'https://cdn.example.test/a.mpd',
    container: 'legacy',
  },
  {
    name: 'legacy container, ts path',
    streamUrl: 'https://cdn.example.test/a.ts',
    container: 'legacy',
  },
  { name: 'declared hls, mpd path', streamUrl: 'https://cdn.example.test/a.mpd', container: 'hls' },
  { name: 'drm', streamUrl: 'https://cdn.example.test/a.m3u8', drm: true },
  { name: 'plain', streamUrl: 'https://cdn.example.test/a.mp4' },
];

describe('protected mark ⇔ player refusal (UX-07)', () => {
  it.each(CASES)('$name', async (entry) => {
    const marked = isProtectedStream(entry);
    const channel = {
      key: 'm:live:1',
      sourceId: 'm',
      type: 'live',
      externalId: '1',
      nameNorm: 'c',
      order: 0,
      streamPath: '',
      ...entry,
    } as unknown as Channel;
    const live = await resolveStream(channel, source);
    const vod = resolveM3uVod(entry as Parameters<typeof resolveM3uVod>[0]);
    expect(live.status === 'unsupported').toBe(marked);
    expect(vod.status === 'unsupported').toBe(marked);
  });
});
