// SRC-08 AC4: the session's active list — persisted, effective (fallback to the first list), and
// published only when the effective list changes.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsRepo, sourcesRepo, wipeAll, type Source } from '@/core/db';
import {
  forgetActiveSource,
  getActiveSourceSnapshot,
  loadActiveSource,
  refreshActiveSource,
  setActiveSource,
  subscribeActiveSource,
} from './activeSource';

afterEach(async () => {
  forgetActiveSource();
  vi.restoreAllMocks();
  await wipeAll();
});

const make = (id: string, createdAt: number): Source => ({
  id,
  kind: 'm3u-url',
  name: id,
  prefs: { liveFormat: 'auto' },
  createdAt,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
});

async function seed(...ids: string[]) {
  for (const [i, id] of ids.entries()) await sourcesRepo.put(make(id, i + 1));
}

describe('core/session — active source', () => {
  it('resolves the stored list, or the first list when none (or a removed one) is stored', async () => {
    await seed('a', 'b');
    expect(await loadActiveSource()).toBe('a');
    forgetActiveSource();
    await settingsRepo.set('activeSourceId', 'b');
    expect(await loadActiveSource()).toBe('b');
    forgetActiveSource();
    await settingsRepo.set('activeSourceId', 'gone');
    expect(await loadActiveSource()).toBe('a');
    expect(getActiveSourceSnapshot()).toEqual({ id: 'a', known: true });
  });

  it('loadActiveSource reads once; concurrent callers share the read', async () => {
    await seed('a');
    const list = vi.spyOn(sourcesRepo, 'list');
    await Promise.all([loadActiveSource(), loadActiveSource()]);
    await loadActiveSource();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('setActiveSource persists first, then publishes the new effective list', async () => {
    await seed('a', 'b');
    await loadActiveSource();
    const seen: (string | undefined)[] = [];
    const unsubscribe = subscribeActiveSource(() => seen.push(getActiveSourceSnapshot().id));
    const set = vi.spyOn(settingsRepo, 'set');
    await setActiveSource('b');
    expect(set).toHaveBeenCalledWith('activeSourceId', 'b');
    expect(await settingsRepo.get('activeSourceId')).toBe('b');
    expect(seen).toEqual(['b']);
    unsubscribe();
  });

  it('storing the list that is already active by fallback is not a change', async () => {
    await seed('a', 'b');
    await loadActiveSource(); // 'a' by fallback (nothing stored)
    const listener = vi.fn();
    const unsubscribe = subscribeActiveSource(listener);
    await setActiveSource('a');
    expect(await settingsRepo.get('activeSourceId')).toBe('a');
    expect(listener).not.toHaveBeenCalled();
    await setActiveSource(undefined); // back to the fallback, still 'a'
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('refreshActiveSource publishes when lists were removed (fallback) or the last one went', async () => {
    await seed('a', 'b');
    await settingsRepo.set('activeSourceId', 'b');
    await loadActiveSource();
    const listener = vi.fn();
    const unsubscribe = subscribeActiveSource(listener);
    await sourcesRepo.remove('b');
    await refreshActiveSource();
    expect(getActiveSourceSnapshot().id).toBe('a');
    await sourcesRepo.remove('a');
    await refreshActiveSource();
    expect(getActiveSourceSnapshot()).toEqual({ id: undefined, known: true });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('a read that started before a switch does not overwrite it', async () => {
    await seed('a', 'b');
    const stale = loadActiveSource();
    await setActiveSource('b');
    await stale;
    expect(getActiveSourceSnapshot().id).toBe('b');
  });
});
