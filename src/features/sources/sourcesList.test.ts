// SRC-08: the saved-lists store, the effective active list and the display order.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sourcesRepo, wipeAll, type Source } from '@/core/db';
import {
  effectiveActiveId,
  forgetSources,
  getSourcesListSnapshot,
  reloadSources,
  reloadSourcesIfLoaded,
  sortSources,
} from './sourcesList';

afterEach(async () => {
  vi.restoreAllMocks();
  forgetSources();
  await wipeAll();
});

const make = (id: string, name: string, createdAt: number): Source => ({
  id,
  kind: 'm3u-url',
  name,
  prefs: { liveFormat: 'auto' },
  createdAt,
  lastSyncStatus: 'never',
  stats: { live: 0, movies: 0, series: 0 },
});

describe('sortSources (active first, then by name)', () => {
  const lists = [make('1', 'zeta', 1), make('2', 'Alpha', 2), make('3', 'beta 10', 3)];

  it('puts the active list first, the rest by locale-aware name', () => {
    expect(sortSources(lists, '1', 'en').map((s) => s.name)).toEqual(['zeta', 'Alpha', 'beta 10']);
    expect(sortSources(lists, undefined, 'en').map((s) => s.name)).toEqual([
      'Alpha',
      'beta 10',
      'zeta',
    ]);
  });

  it('numeric-aware and stable for equal names', () => {
    const more = [make('a', 'List 10', 1), make('b', 'List 2', 2), make('c', 'list 2', 3)];
    expect(sortSources(more, undefined, 'pt-PT').map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('handles any number of lists', () => {
    const many = Array.from({ length: 250 }, (_, i) => make(String(i), `List ${i}`, i));
    expect(sortSources(many, '249', 'en')).toHaveLength(250);
    expect(sortSources(many, '249', 'en')[0]?.id).toBe('249');
  });
});

describe('effectiveActiveId', () => {
  const lists = [make('1', 'a', 1), make('2', 'b', 2)];
  it('the stored list when it exists, else the first one (Live fallback)', () => {
    expect(effectiveActiveId(lists, '2')).toBe('2');
    expect(effectiveActiveId(lists, 'gone')).toBe('1');
    expect(effectiveActiveId(lists, undefined)).toBe('1');
    expect(effectiveActiveId([], '2')).toBeUndefined();
  });
});

describe('sources list store', () => {
  it('reloadSources publishes the stored lists in creation order', async () => {
    await sourcesRepo.put(make('2', 'b', 2));
    await sourcesRepo.put(make('1', 'a', 1));
    await reloadSources();
    expect(getSourcesListSnapshot().sources?.map((s) => s.id)).toEqual(['1', '2']);
  });

  it('reloadSourcesIfLoaded does nothing until someone has read the list', async () => {
    reloadSourcesIfLoaded();
    await Promise.resolve();
    expect(getSourcesListSnapshot().sources).toBeUndefined();
    await reloadSources();
    await sourcesRepo.put(make('1', 'a', 1));
    reloadSourcesIfLoaded();
    await expect.poll(() => getSourcesListSnapshot().sources?.length).toBe(1);
  });

  // Review fix 8: the selector and My lists opening together share one read.
  it('"shared" reads join the one in flight', async () => {
    const list = vi.spyOn(sourcesRepo, 'list');
    const reads = [reloadSources('shared'), reloadSources('shared'), reloadSources('shared')];
    await Promise.all(reads);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('"fresh" reads after a change queue ONE read behind the one in flight (latest data wins)', async () => {
    const list = vi.spyOn(sourcesRepo, 'list');
    const first = reloadSources('shared');
    await sourcesRepo.put(make('new', 'new', 9));
    const fresh = [reloadSources(), reloadSources()];
    await Promise.all([first, ...fresh]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(getSourcesListSnapshot().sources?.map((s) => s.id)).toEqual(['new']);
  });
});
