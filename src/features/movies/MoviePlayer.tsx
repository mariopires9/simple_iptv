// Movie player area (VOD-02 AC3, VOD-03): the shared VOD player (`@/ui/vod/VodPlayer`) with the
// movie's stream resolver, its resume position and the history writes of its progress.
import { useCallback } from 'react';
import { historyRepo, type Movie, type Source } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import type { ProgressSnapshot } from '@/ui/vod/resume';
import { VodPlayer } from '@/ui/vod/VodPlayer';
import { needsInfoExt, resolveMovieStream } from './resolveMovie';

/** How long Play waits for `get_vod_info` when the catalogue has no extension (ms). */
export const INFO_WAIT_MS = 3_000;

export interface MoviePlayerProps {
  source: Source;
  movie: Movie;
  /** Resume position (seconds). */
  startAt: number | undefined;
  /**
   * The container extension from `get_vod_info` once the details settle (`undefined` when they
   * have none or failed). Only asked when the catalogue has no extension (`needsInfoExt`).
   */
  getInfoExt: () => Promise<string | undefined>;
  /** Upper bound of the wait for `getInfoExt` before falling back. Default {@link INFO_WAIT_MS}. */
  infoWaitMs?: number;
  /** A position was saved (the details refresh "Resume at"). */
  onSaved?: (snapshot: ProgressSnapshot) => void;
  onClose: () => void;
}

/** The details' extension, or `undefined` after `ms` (the resolver then uses its fallback). */
function waitForExt(get: () => Promise<string | undefined>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([get().catch(() => undefined), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Resolves the stream ONCE per mount (one Play press) and per Retry: details that arrive later
 * never reload the player.
 */
export function MoviePlayer({
  source,
  movie,
  startAt,
  getInfoExt,
  infoWaitMs = INFO_WAIT_MS,
  onSaved,
  onClose,
}: MoviePlayerProps) {
  const resolve = useCallback(async () => {
    const ext = needsInfoExt(movie, source) ? await waitForExt(getInfoExt, infoWaitMs) : undefined;
    return resolveMovieStream(movie, source, { infoExt: ext });
  }, [movie, source, getInfoExt, infoWaitMs]);

  // VOD-03: one history entry per movie, its position and whether it was watched (> 95 %).
  const save = useCallback(
    (snapshot: ProgressSnapshot) => {
      historyRepo.upsert({ itemKey: movie.key, ...snapshot }).then(
        () => onSaved?.(snapshot),
        (error: unknown) =>
          log.warn('movies: saving the position failed', {
            error: error instanceof Error ? error.name : 'unknown',
          }),
      );
    },
    [movie.key, onSaved],
  );

  return (
    <VodPlayer
      title={movie.name}
      resolve={resolve}
      startAt={startAt}
      onProgress={save}
      onClose={onClose}
      texts={t.movies.player}
      testId="movie-player"
      logPrefix="movies"
    />
  );
}
