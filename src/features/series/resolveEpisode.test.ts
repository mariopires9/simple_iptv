// VOD-04: an episode of an M3U show grouped at import plays its own list entry; a series entry
// without stored episodes plays the series entry itself. DRM entries are never attempted.
import { describe, expect, it } from 'vitest';
import type { Episode, Series, Source } from '@/core/db';
import { resolveEpisodeStream } from './resolveEpisode';

const m3u: Source = {
  id: 'm1',
  kind: 'm3u-url',
  name: 'List',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};
const show: Series = {
  key: 'm1:series:s1',
  sourceId: 'm1',
  type: 'series',
  externalId: 's1',
  name: 'Show',
  order: 0,
};
const episode: Episode = {
  key: 'm1:series:s1:ep:e1',
  externalId: 'e1',
  season: 1,
  number: 1,
  title: 'Pilot',
  streamPath: '',
};

describe('resolveEpisodeStream (M3U)', () => {
  it('a grouped episode plays its own URL and container', async () => {
    const resolved = await resolveEpisodeStream(m3u, show, {
      ...episode,
      streamUrl: 'https://cdn.example.test/show/s1e1.mkv',
      container: 'mkv',
    });
    expect(resolved).toEqual({
      status: 'ok',
      descriptor: { url: 'https://cdn.example.test/show/s1e1.mkv', kind: 'vod', container: 'mkv' },
    });
  });

  it('without an episode URL, the series entry is the stream', async () => {
    const resolved = await resolveEpisodeStream(
      m3u,
      { ...show, streamUrl: 'https://cdn.example.test/show/entry.mp4' },
      episode,
    );
    expect(resolved).toMatchObject({
      status: 'ok',
      descriptor: { url: 'https://cdn.example.test/show/entry.mp4' },
    });
  });

  it('a DRM episode is never attempted', async () => {
    const resolved = await resolveEpisodeStream(m3u, show, {
      ...episode,
      streamUrl: 'https://cdn.example.test/drm/manifest.mpd',
      drm: true,
    });
    expect(resolved).toEqual({ status: 'unsupported', reason: 'drm' });
  });
});
