// Watch progress of a series (SER-02 AC3, SER-03 AC1, VOD-03 rules), in the `history` table:
// - one entry per episode, keyed by the episode key (`episodeItemKey`): its position, duration
//   and whether it was watched (> 95 % or played to the end);
// - one entry for the series itself, pointing at the episode to watch (`episodeKey`) — what
//   "Continue S2 E5" and Home "Continue watching" read:
//   - while an episode is unfinished: that episode, with its position and duration;
//   - once it is finished and another follows: the next episode, from the start (no position or
//     duration of the previous one is carried over), so the series stays in "Continue watching";
//   - after the last episode: that episode, `completed`.
import {
  episodeKeyPrefix,
  historyRepo,
  type Episode,
  type HistoryEntry,
  type Series,
} from '@/core/db';
import type { ProgressSnapshot } from '@/ui/vod/resume';
import type { EpisodeProgress } from './episodes';

export interface SeriesHistory {
  entry: HistoryEntry | undefined;
  /** Progress per episode key. */
  episodes: Map<string, EpisodeProgress>;
}

/** The series entry and this series' episode entries only (primary-key prefix read). */
export async function loadSeriesHistory(series: Pick<Series, 'key'>): Promise<SeriesHistory> {
  const [entry, list] = await Promise.all([
    historyRepo.get(series.key),
    historyRepo.listByKeyPrefix(episodeKeyPrefix(series.key)),
  ]);
  return { entry, episodes: new Map(list.map((e) => [e.itemKey, e])) };
}

/**
 * Writes an episode's progress and points the series entry at the episode to watch (see the
 * header). `next` is the episode after this one in playing order, if any.
 */
export async function saveEpisodeProgress(
  series: Pick<Series, 'key'>,
  episode: Pick<Episode, 'key'>,
  snapshot: ProgressSnapshot,
  next: Pick<Episode, 'key'> | undefined,
): Promise<void> {
  const lastWatchedAt = Date.now();
  await historyRepo.upsert({ itemKey: episode.key, ...snapshot, lastWatchedAt });
  // `set`, not `upsert`: fields of the previous episode must not survive (review #2).
  await historyRepo.set(
    snapshot.completed && next
      ? { itemKey: series.key, episodeKey: next.key, positionSec: 0, lastWatchedAt }
      : {
          itemKey: series.key,
          episodeKey: episode.key,
          positionSec: snapshot.positionSec,
          ...(snapshot.durationSec !== undefined ? { durationSec: snapshot.durationSec } : {}),
          completed: snapshot.completed,
          lastWatchedAt,
        },
  );
}
