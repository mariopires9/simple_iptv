import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sourcesRepo, wipeAll, type Source } from '@/core/db';
import {
  getSourcesPresenceSnapshot,
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

// Review finding 1: an invalidation during the first read never leaves subscribers stuck.
describe('sources presence — invalidation while a read is in flight', () => {
  it('publishes a fresh snapshot and applies the read when nothing newer exists', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSourcesPresent(listener);
    const before = getSourcesPresenceSnapshot();
    const read = hasSources();
    invalidateSourcesPresence();
    const after = getSourcesPresenceSnapshot();
    expect(after).not.toBe(before);
    expect(after.version).toBeGreaterThan(before.version);
    expect(listener).toHaveBeenCalledTimes(1);

    expect(await read).toBe(false);
    // Nobody started a newer read: the in-flight answer is applied.
    expect(getSourcesPresent()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('a newer read started after the invalidation wins over the stale one', async () => {
    const list = vi.spyOn(sourcesRepo, 'list');
    list.mockResolvedValueOnce([]); // stale: before the source was added
    const stale = hasSources();
    invalidateSourcesPresence();
    list.mockResolvedValueOnce([source]);
    const fresh = hasSources();
    expect(await stale).toBe(false);
    expect(await fresh).toBe(true);
    expect(getSourcesPresent()).toBe(true);
  });
});
