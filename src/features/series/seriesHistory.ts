// Watch progress of a series (SER-02 AC3, SER-03 AC1, VOD-03 rules), in the `history` table:
// - one entry per episode, keyed by the episode key (`episodeItemKey`): its position, duration
//   and whether it was watched (> 95 % or played to the end);
// - one entry for the series itself, pointing at the last episode played (`episodeKey`) with
//   that episode's position — what "Continue S2 E5" and "Continue watching" read. The series
//   entry is `completed` only once its last episode is.
import {
  historyRepo,
  isEpisodeItemKey,
  type Episode,
  type HistoryEntry,
  type Series,
} from '@/core/db';
import type { ProgressSnapshot } from '@/ui/vod/resume';
import type { EpisodeProgress } from './episodes';

/** Upper bound of the history entries of a source read for one series. */
export const HISTORY_LIMIT = 20_000;

export interface SeriesHistory {
  entry: HistoryEntry | undefined;
  /** Progress per episode key. */
  episodes: Map<string, EpisodeProgress>;
}

export async function loadSeriesHistory(
  series: Pick<Series, 'key' | 'sourceId'>,
): Promise<SeriesHistory> {
  const [entry, all] = await Promise.all([
    historyRepo.get(series.key),
    historyRepo.listRecent(series.sourceId, 'series', HISTORY_LIMIT),
  ]);
  const prefix = `${series.key}:`;
  const episodes = new Map<string, EpisodeProgress>();
  for (const e of all) {
    if (e.itemKey.startsWith(prefix) && isEpisodeItemKey(e.itemKey)) episodes.set(e.itemKey, e);
  }
  return { entry, episodes };
}

/** Writes an episode's progress and moves the series entry to it. */
export async function saveEpisodeProgress(
  series: Pick<Series, 'key'>,
  episode: Pick<Episode, 'key'>,
  snapshot: ProgressSnapshot,
  isLastEpisode: boolean,
): Promise<void> {
  const lastWatchedAt = Date.now();
  await historyRepo.upsert({ itemKey: episode.key, ...snapshot, lastWatchedAt });
  await historyRepo.upsert({
    itemKey: series.key,
    episodeKey: episode.key,
    positionSec: snapshot.positionSec,
    ...(snapshot.durationSec !== undefined ? { durationSec: snapshot.durationSec } : {}),
    completed: snapshot.completed && isLastEpisode,
    lastWatchedAt,
  });
}
