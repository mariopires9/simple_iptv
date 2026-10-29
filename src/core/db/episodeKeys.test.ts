// SER-02/03: episode keys (history entries per episode).
import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  episodeItemKey,
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
