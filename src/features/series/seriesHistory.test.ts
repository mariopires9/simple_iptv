// SER-02 AC3 / SER-03: the series history — one entry per episode, the series entry pointing at
// the episode to watch (the next one once an episode is finished), no stale fields, and reads
// limited to the series' own episodes.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { episodeItemKey, historyRepo, itemKey, wipeAll } from '@/core/db';
import { loadSeriesHistory, saveEpisodeProgress } from './seriesHistory';

const series = { key: itemKey('s1', 'series', '3001') };
const other = { key: itemKey('s1', 'series', '3002') };
const ep = (id: string, of = series) => ({ key: episodeItemKey(of.key, id) });

afterEach(async () => {
  vi.restoreAllMocks();
  await wipeAll();
});

describe('saveEpisodeProgress', () => {
  it('an unfinished episode: the series entry carries its position and duration', async () => {
    await saveEpisodeProgress(
      series,
      ep('1'),
      { positionSec: 300, durationSec: 1200, completed: false },
      ep('2'),
    );
    expect(await historyRepo.get(ep('1').key)).toMatchObject({
      positionSec: 300,
      durationSec: 1200,
      completed: false,
    });
    expect(await historyRepo.get(series.key)).toMatchObject({
      episodeKey: ep('1').key,
      positionSec: 300,
      durationSec: 1200,
      completed: false,
    });
  });

  it('a finished episode with a next one: the series points at the next, from the start (review #1)', async () => {
    await saveEpisodeProgress(
      series,
      ep('1'),
      { positionSec: 300, durationSec: 1200, completed: false },
      ep('2'),
    );
    await saveEpisodeProgress(
      series,
      ep('1'),
      { positionSec: 1190, durationSec: 1200, completed: true },
      ep('2'),
    );
    const entry = await historyRepo.get(series.key);
    expect(entry).toMatchObject({ episodeKey: ep('2').key, positionSec: 0, completed: false });
    expect(entry).not.toHaveProperty('durationSec');
    expect(await historyRepo.get(ep('1').key)).toMatchObject({ completed: true });
  });

  it('no stale duration of the previous episode (review #2)', async () => {
    await saveEpisodeProgress(
      series,
      ep('1'),
      { positionSec: 300, durationSec: 1200, completed: false },
      ep('2'),
    );
    // The next episode's duration is not known yet.
    await saveEpisodeProgress(series, ep('2'), { positionSec: 70, completed: false }, ep('3'));
    const entry = await historyRepo.get(series.key);
    expect(entry).toMatchObject({ episodeKey: ep('2').key, positionSec: 70 });
    expect(entry).not.toHaveProperty('durationSec');
  });

  it('the last episode finished: the series entry is completed', async () => {
    await saveEpisodeProgress(
      series,
      ep('9'),
      { positionSec: 1200, durationSec: 1200, completed: true },
      undefined,
    );
    expect(await historyRepo.get(series.key)).toMatchObject({
      episodeKey: ep('9').key,
      completed: true,
    });
  });
});

describe('loadSeriesHistory (review #6)', () => {
  it("reads the series entry and only this series' episodes, by key prefix", async () => {
    await historyRepo.upsert({ itemKey: ep('1').key, positionSec: 10 });
    await historyRepo.upsert({ itemKey: ep('2').key, completed: true });
    await historyRepo.upsert({ itemKey: ep('5', other).key, positionSec: 99 });
    // A series whose key extends this one's must not match either.
    await historyRepo.upsert({ itemKey: episodeItemKey(itemKey('s1', 'series', '30010'), '1') });
    await historyRepo.upsert({ itemKey: series.key, episodeKey: ep('1').key });
    const recent = vi.spyOn(historyRepo, 'listRecent');
    const history = await loadSeriesHistory(series);
    expect(recent).not.toHaveBeenCalled();
    expect(history.entry?.episodeKey).toBe(ep('1').key);
    expect([...history.episodes.keys()].sort()).toEqual([ep('1').key, ep('2').key].sort());
  });
});
