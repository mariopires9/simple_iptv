// SER-02/03: episode keys (history entries per episode), the exact history write, prefix reads and
// the series season count.
import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  catalogRepo,
  episodeItemKey,
  episodeKeyPrefix,
  historyRepo,
  isEpisodeItemKey,
  itemKey,
  parseItemKey,
  wipeAll,
} from './index';

afterAll(async () => {
  await wipeAll();
});

describe('episodeItemKey', () => {
  const series = itemKey('s1', 'series', '3001');

  it('is a valid series item key under the series key', () => {
    const key = episodeItemKey(series, '40101');
    expect(key).toBe('s1:series:3001:ep:40101');
    expect(parseItemKey(key)).toEqual({
      sourceId: 's1',
      type: 'series',
      externalId: '3001:ep:40101',
    });
    expect(isEpisodeItemKey(key)).toBe(true);
  });

  it('series, movie and channel keys are not episode keys', () => {
    expect(isEpisodeItemKey(series)).toBe(false);
    expect(isEpisodeItemKey(itemKey('s1', 'movie', 'x:ep:1'))).toBe(false);
    expect(isEpisodeItemKey('nonsense')).toBe(false);
  });

  it('rejects anything but a series key and empty ids', () => {
    expect(() => episodeItemKey(itemKey('s1', 'movie', '1'), '2')).toThrow(TypeError);
    expect(() => episodeItemKey(episodeItemKey(series, '1'), '2')).toThrow(TypeError);
    expect(() => episodeItemKey('bad', '2')).toThrow(TypeError);
    expect(() => episodeItemKey(series, '')).toThrow(TypeError);
  });

  it('works as a history key', async () => {
    const key = episodeItemKey(series, '40101');
    const entry = await historyRepo.upsert({ itemKey: key, positionSec: 10 });
    expect(entry).toMatchObject({ sourceId: 's1', type: 'series', positionSec: 10 });
  });
});

describe('historyRepo.set / listByKeyPrefix', () => {
  const series = itemKey('s7', 'series', '1');

  it('set writes exactly the given fields (no merge with the stored entry)', async () => {
    await historyRepo.upsert({
      itemKey: series,
      positionSec: 300,
      durationSec: 1200,
      episodeKey: 'x',
    });
    const entry = await historyRepo.set({ itemKey: series, positionSec: 0, episodeKey: 'y' });
    expect(entry).toEqual({
      itemKey: series,
      sourceId: 's7',
      type: 'series',
      lastWatchedAt: expect.any(Number) as number,
      completed: false,
      positionSec: 0,
      episodeKey: 'y',
    });
    expect(await historyRepo.get(series)).toEqual(entry);
    await expect(historyRepo.set({ itemKey: 'bad' })).rejects.toThrow(TypeError);
  });

  it('listByKeyPrefix reads only the keys under the prefix', async () => {
    await historyRepo.upsert({ itemKey: episodeItemKey(series, 'a') });
    await historyRepo.upsert({ itemKey: episodeItemKey(series, 'b') });
    await historyRepo.upsert({ itemKey: episodeItemKey(itemKey('s7', 'series', '10'), 'c') });
    const found = await historyRepo.listByKeyPrefix(episodeKeyPrefix(series));
    expect(found.map((e) => e.itemKey).sort()).toEqual([
      episodeItemKey(series, 'a'),
      episodeItemKey(series, 'b'),
    ]);
    await expect(historyRepo.listByKeyPrefix('')).rejects.toThrow(TypeError);
  });
});

describe('catalogRepo.setSeasonCount (review #7)', () => {
  it('records the count on the series row without touching the search index', async () => {
    await catalogRepo.replaceForSource('s8', 'series', {
      categories: [],
      items: [{ externalId: '1', name: 'Show' }],
    });
    await catalogRepo.putSearchIndex({ sourceId: 's8', data: '{}', builtAt: 1 });
    const key = itemKey('s8', 'series', '1');
    expect(await catalogRepo.setSeasonCount(key, 4)).toBe(true);
    expect((await catalogRepo.get('series', key))?.seasonCount).toBe(4);
    expect(await catalogRepo.getSearchIndex('s8')).toBeDefined();
    expect(await catalogRepo.setSeasonCount(itemKey('s8', 'series', 'gone'), 1)).toBe(false);
  });
});
