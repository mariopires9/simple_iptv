// UX-07: "Hide protected content" is applied to the Live screen only for a list that may have
// protected channels — none are walked or filtered for Xtream lists or an M3U import without any.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { settingsRepo, sourcesRepo, wipeAll, type Source } from '@/core/db';
import { loadLiveSource } from './liveSource';

const source = (extra: Partial<Source>): Source => ({
  id: 's1',
  kind: 'm3u-url',
  name: 'List',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
  ...extra,
});

async function hideFor(extra: Partial<Source>, hide = true): Promise<boolean | undefined> {
  await sourcesRepo.put(source(extra));
  await settingsRepo.set('activeSourceId', 's1');
  await settingsRepo.set('hideProtectedContent', hide);
  const state = await loadLiveSource();
  return state.status === 'ready' ? state.hideProtected : undefined;
}

afterEach(async () => {
  await wipeAll();
});

describe('loadLiveSource — hide protected content (UX-07)', () => {
  it('off: never filters', async () => {
    expect(await hideFor({ protectedCounts: { live: 5, movies: 0, series: 0 } }, false)).toBe(
      false,
    );
  });

  it('on: filters an M3U list with protected channels, or one imported before the counts', async () => {
    expect(await hideFor({ protectedCounts: { live: 5, movies: 0, series: 0 } })).toBe(true);
    expect(await hideFor({})).toBe(true);
  });

  it('on: skips the work for a list without protected channels, and for Xtream', async () => {
    expect(await hideFor({ protectedCounts: { live: 0, movies: 3, series: 0 } })).toBe(false);
    expect(await hideFor({ kind: 'xtream' })).toBe(false);
  });
});
