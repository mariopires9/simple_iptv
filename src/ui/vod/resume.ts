// Resume policy of VOD playback (VOD-03, SER-03), shared by Movies and Series:
// - the position is saved every 10 s while playing, on pause and on exit (useProgressSaver.ts);
// - a saved position is offered ("Resume at mm:ss" + "Start over") from 1 min up to 95 % of the
//   duration;
// - beyond 95 % (or on `ended`) the item counts as watched: `completed`, no resume, no progress
//   bar ("Continue watching" drops it);
// - Home "Continue watching" (FAV-02, features/favorites) applies the same rules.
import type { HistoryEntry } from '@/core/db';

/** Saved positions below this are not worth resuming (s). */
export const RESUME_MIN_SEC = 60;
/** Watched beyond this fraction of the duration = completed. */
export const COMPLETED_FRACTION = 0.95;
/** Periodic save while playing (ms). */
export const SAVE_INTERVAL_MS = 10_000;

/** What one save writes (the caller adds the keys). */
export interface ProgressSnapshot {
  positionSec: number;
  /** Absent when the media has no finite duration yet. */
  durationSec?: number;
  completed: boolean;
}

const finitePositive = (n: number | undefined): n is number =>
  n !== undefined && Number.isFinite(n) && n > 0;

/** Whether `positionSec` of `durationSec` counts as watched (> 95 %). */
export function isCompleted(positionSec: number, durationSec: number | undefined): boolean {
  return finitePositive(durationSec) && positionSec / durationSec > COMPLETED_FRACTION;
}

/** The snapshot to save for a media position (`ended` always completes). */
export function progressSnapshot(
  positionSec: number,
  durationSec: number | undefined,
  ended = false,
): ProgressSnapshot {
  const duration = finitePositive(durationSec) ? durationSec : undefined;
  const position = Math.max(0, Math.floor(Number.isFinite(positionSec) ? positionSec : 0));
  return {
    positionSec: position,
    ...(duration !== undefined ? { durationSec: Math.round(duration) } : {}),
    completed: ended || isCompleted(positionSec, duration),
  };
}

/**
 * Position to resume from, if any: not completed, at least {@link RESUME_MIN_SEC} and at most
 * 95 % of the duration (when known).
 */
export function resumePosition(
  entry: Pick<HistoryEntry, 'positionSec' | 'durationSec' | 'completed'> | undefined,
): number | undefined {
  if (!entry || entry.completed) return undefined;
  const { positionSec, durationSec } = entry;
  if (positionSec === undefined || !Number.isFinite(positionSec)) return undefined;
  if (positionSec < RESUME_MIN_SEC) return undefined;
  if (finitePositive(durationSec) && positionSec / durationSec > COMPLETED_FRACTION)
    return undefined;
  return positionSec;
}

/** Fraction watched of an entry (progress bars), or `undefined` when there is nothing to show. */
export function watchedFraction(
  entry: Pick<HistoryEntry, 'positionSec' | 'durationSec' | 'completed'> | undefined,
): number | undefined {
  if (!entry || entry.completed) return undefined;
  const { positionSec, durationSec } = entry;
  if (!finitePositive(positionSec) || !finitePositive(durationSec)) return undefined;
  const fraction = positionSec / durationSec;
  return fraction < 1 ? fraction : undefined;
}
