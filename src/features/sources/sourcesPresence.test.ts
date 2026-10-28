import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sourcesRepo, wipeAll, type Source } from '@/core/db';
import {
  getSourcesPresent,
  hasSources,
  invalidateSourcesPresence,
  setSourcesPresent,
  subscribeSourcesPresent,
} from './sourcesPresence';

afterEach(async () => {
  invalidateSourcesPresence();
  vi.restoreAllMocks();
  await wipeAll();
});

const source: Source = {
  id: 's1',
  kind: 'xtream',
  name: 'Test',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'never',
  stats: { live: 0, movies: 0, series: 0 },
};

describe('sources presence cache (UX-01 guard)', () => {
  it('reads IndexedDB once, then answers from the cache', async () => {
    const list = vi.spyOn(sourcesRepo, 'list');
    expect(getSourcesPresent()).toBeUndefined();
    expect(await hasSources()).toBe(false);
    expect(getSourcesPresent()).toBe(false);
    expect(await hasSources()).toBe(false);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('sees an existing source', async () => {
    await sourcesRepo.put(source);
    expect(await hasSources()).toBe(true);
  });

  it('setSourcesPresent updates the answer and notifies subscribers', async () => {
    expect(await hasSources()).toBe(false);
    const listener = vi.fn();
    const unsubscribe = subscribeSourcesPresent(listener);
    setSourcesPresent(true);
    expect(getSourcesPresent()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    invalidateSourcesPresence();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSourcesPresent()).toBeUndefined();
  });

  it('a failed read is not cached', async () => {
    vi.spyOn(sourcesRepo, 'list').mockRejectedValueOnce(new Error('db down'));
    await expect(hasSources()).rejects.toThrow('db down');
    expect(getSourcesPresent()).toBeUndefined();
    expect(await hasSources()).toBe(false);
  });

  it('an answer set while a read is in flight wins over the read', async () => {
    const read = hasSources();
    setSourcesPresent(true);
    await read;
    expect(getSourcesPresent()).toBe(true);
  });
});
