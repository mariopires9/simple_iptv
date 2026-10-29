// Synthetic sources for the catalogue screen tests (Movies, Series; shared since SER-01).
import type { Source } from '@/core/db';

export function m3uSource(id: string, name: string, createdAt: number, lastSyncAt = 1): Source {
  return {
    id,
    kind: 'm3u-url',
    name,
    prefs: { liveFormat: 'auto' },
    createdAt,
    lastSyncAt,
    lastSyncStatus: 'ok',
    stats: { live: 0, movies: 0, series: 0 },
  };
}
