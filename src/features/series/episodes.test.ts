// SER-02 AC2/AC3, SER-03 AC2/AC3: playing order, next episode across seasons, "Continue", labels.
import { describe, expect, it } from 'vitest';
import type { Episode, Season } from '@/core/db';
import {
  SPECIALS_SEASON,
  continueTarget,
  customSeasonName,
  episodeState,
  nextEpisode,
  orderSeasons,
  playOrder,
  type EpisodeProgress,
} from './episodes';

const ep = (season: number, number: number): Episode => ({
  key: `s:series:1:ep:${season}-${number}`,
  externalId: `${season}-${number}`,
  season,
  number,
  title: '',
  streamPath: '',
});
// Deliberately out of order.
const seasons: Season[] = [
  { number: 2, episodes: [ep(2, 2), ep(2, 1)] },
  { number: 1, episodes: [ep(1, 1), ep(1, 2)] },
];
const key = (s: number, n: number) => ep(s, n).key;

describe('playOrder / nextEpisode', () => {
  it('seasons ascending, then episode numbers', () => {
    expect(playOrder(seasons).map((e) => e.externalId)).toEqual(['1-1', '1-2', '2-1', '2-2']);
  });

  it('crosses into the next season; nothing after the last episode', () => {
    expect(nextEpisode(seasons, key(1, 1))?.externalId).toBe('1-2');
    expect(nextEpisode(seasons, key(1, 2))?.externalId).toBe('2-1');
    expect(nextEpisode(seasons, key(2, 2))).toBeUndefined();
    expect(nextEpisode(seasons, 'unknown')).toBeUndefined();
  });
});

describe('episodeState', () => {
  it.each([
    [undefined, { kind: 'new' }],
    [{ completed: true, positionSec: 10 }, { kind: 'watched' }],
    [
      { completed: false, positionSec: 300, durationSec: 1200 },
      { kind: 'progress', fraction: 0.25, resumeAt: 300 },
    ],
    [
      { completed: false, positionSec: 30, durationSec: 1200 },
      { kind: 'progress', fraction: 0.025, resumeAt: undefined },
    ],
    [{ completed: false, positionSec: 0 }, { kind: 'new' }],
  ] as const)('%j', (progress, expected) => {
    expect(episodeState(progress)).toEqual(expected);
  });
});

describe('continueTarget (SER-02 AC3)', () => {
  const progress = (entries: [string, EpisodeProgress][]) => new Map(entries);

  it('no history: start at the first episode', () => {
    expect(continueTarget(seasons, undefined, new Map())).toMatchObject({
      kind: 'start',
      episode: { externalId: '1-1' },
    });
  });

  it('an unfinished episode is continued from its position', () => {
    const target = continueTarget(
      seasons,
      { episodeKey: key(2, 1) },
      progress([[key(2, 1), { completed: false, positionSec: 400, durationSec: 2400 }]]),
    );
    expect(target).toMatchObject({
      kind: 'continue',
      episode: { externalId: '2-1' },
      resumeAt: 400,
    });
  });

  it('a finished episode moves on to the next one (across seasons)', () => {
    const target = continueTarget(
      seasons,
      { episodeKey: key(1, 2) },
      progress([[key(1, 2), { completed: true }]]),
    );
    expect(target).toMatchObject({
      kind: 'continue',
      episode: { externalId: '2-1' },
      resumeAt: undefined,
    });
  });

  it('after the last episode, or an episode no longer listed: from the start', () => {
    expect(
      continueTarget(
        seasons,
        { episodeKey: key(2, 2) },
        progress([[key(2, 2), { completed: true }]]),
      ),
    ).toMatchObject({ kind: 'start', episode: { externalId: '1-1' } });
    expect(continueTarget(seasons, { episodeKey: 'gone' }, new Map())).toMatchObject({
      kind: 'start',
    });
  });

  it('no episodes: nothing to play', () => {
    expect(continueTarget([], undefined, new Map())).toBeUndefined();
  });
});

describe('customSeasonName (SER-02 AC2)', () => {
  it.each([
    [undefined, undefined],
    ['Season 1', undefined],
    ['Temporada 2', undefined],
    ['S03', undefined],
    ['  ', undefined],
    ['Specials', 'Specials'],
    ['Season 1: The Beginning', 'Season 1: The Beginning'],
  ])('%s → %s', (name, expected) => {
    expect(customSeasonName({ ...(name !== undefined ? { name } : {}) })).toBe(expected);
  });
});

describe('specials (season 0, review #5)', () => {
  const withSpecials: Season[] = [
    { number: SPECIALS_SEASON, episodes: [ep(0, 1)] },
    { number: 2, episodes: [ep(2, 1)] },
    { number: 1, episodes: [ep(1, 1)] },
  ];

  it('come after the regular seasons', () => {
    expect(orderSeasons(withSpecials).map((s) => s.number)).toEqual([1, 2, 0]);
    expect(playOrder(withSpecials).map((e) => e.externalId)).toEqual(['1-1', '2-1', '0-1']);
  });

  it('are not the default start', () => {
    expect(continueTarget(withSpecials, undefined, new Map())).toMatchObject({
      kind: 'start',
      episode: { externalId: '1-1' },
    });
  });

  it('the last regular episode does not move on into the specials', () => {
    expect(nextEpisode(withSpecials, ep(1, 1).key)?.externalId).toBe('2-1');
    expect(nextEpisode(withSpecials, ep(2, 1).key)).toBeUndefined();
  });

  it('within the specials, the next special follows', () => {
    const specials: Season[] = [{ number: 0, episodes: [ep(0, 2), ep(0, 1)] }];
    expect(nextEpisode(specials, ep(0, 1).key)?.externalId).toBe('0-2');
    expect(continueTarget(specials, undefined, new Map())).toMatchObject({
      episode: { externalId: '0-1' },
    });
  });
});
