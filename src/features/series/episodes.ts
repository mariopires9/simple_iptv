// Pure episode logic of the series screens (SER-02 AC3, SER-03 AC2/AC3): the playing order across
// seasons, the next episode, what "Continue" plays, and per-episode progress from the history.
import type { Episode, HistoryEntry, Season } from '@/core/db';
import { resumePosition, watchedFraction } from '@/ui/vod/resume';

/** Season 0: the panels' "Specials" (extras, not part of the story order). */
export const SPECIALS_SEASON = 0;

/** Display and playing order of the seasons: regular seasons ascending, specials last. */
export function orderSeasons<S extends Pick<Season, 'number'>>(seasons: readonly S[]): S[] {
  const rank = (n: number) => (n === SPECIALS_SEASON ? Number.POSITIVE_INFINITY : n);
  return [...seasons].sort((a, b) => rank(a.number) - rank(b.number));
}

/** Every episode in playing order: regular seasons ascending, then specials; episode numbers. */
export function playOrder(seasons: readonly Season[]): Episode[] {
  return orderSeasons(seasons).flatMap((season) =>
    [...season.episodes].sort((a, b) => a.number - b.number),
  );
}

/**
 * The episode after `key` (crossing into the next regular season); `undefined` after the last
 * one. The end of the regular seasons never moves on into the specials (SER-03 review #5).
 */
export function nextEpisode(seasons: readonly Season[], key: string): Episode | undefined {
  const order = playOrder(seasons);
  const index = order.findIndex((e) => e.key === key);
  const current = order[index];
  const next = index < 0 ? undefined : order[index + 1];
  if (!current || !next) return undefined;
  const special = (e: Episode) => e.season === SPECIALS_SEASON;
  return special(next) && !special(current) ? undefined : next;
}

export function findEpisode(
  seasons: readonly Season[],
  key: string | undefined,
): Episode | undefined {
  if (key === undefined) return undefined;
  for (const season of seasons) {
    const found = season.episodes.find((e) => e.key === key);
    if (found) return found;
  }
  return undefined;
}

/** Saved progress of one episode (its own history entry). */
export type EpisodeProgress = Pick<HistoryEntry, 'positionSec' | 'durationSec' | 'completed'>;

export type EpisodeState =
  | { kind: 'new' }
  | { kind: 'watched' }
  /** Started: `fraction` for the bar, `resumeAt` when worth resuming (VOD-03 rules). */
  | { kind: 'progress'; fraction: number | undefined; resumeAt: number | undefined };

export function episodeState(progress: EpisodeProgress | undefined): EpisodeState {
  if (!progress) return { kind: 'new' };
  if (progress.completed) return { kind: 'watched' };
  const fraction = watchedFraction(progress);
  const resumeAt = resumePosition(progress);
  if (fraction === undefined && resumeAt === undefined) return { kind: 'new' };
  return { kind: 'progress', fraction, resumeAt };
}

export type ContinueTarget =
  /** Nothing watched yet: the first episode. */
  | { kind: 'start'; episode: Episode }
  /** "Continue S2 E5": resume it (`resumeAt`) or start it (the previous one was finished). */
  | { kind: 'continue'; episode: Episode; resumeAt: number | undefined };

/**
 * What the main button plays (SER-02 AC3). The series' history entry points at the last episode
 * played (`episodeKey`): an unfinished one is continued (resumed when worth it), a finished one
 * moves on to the next episode. After the last episode, or without history, it starts over from
 * the first episode.
 */
export function continueTarget(
  seasons: readonly Season[],
  seriesEntry: Pick<HistoryEntry, 'episodeKey'> | undefined,
  progress: ReadonlyMap<string, EpisodeProgress>,
): ContinueTarget | undefined {
  const first = playOrder(seasons)[0];
  if (!first) return undefined;
  const last = findEpisode(seasons, seriesEntry?.episodeKey);
  if (!last) return { kind: 'start', episode: first };
  const state = episodeState(progress.get(last.key));
  if (state.kind !== 'watched') {
    return {
      kind: 'continue',
      episode: last,
      resumeAt: state.kind === 'progress' ? state.resumeAt : undefined,
    };
  }
  const next = nextEpisode(seasons, last.key);
  return next
    ? { kind: 'continue', episode: next, resumeAt: resumePosition(progress.get(next.key)) }
    : { kind: 'start', episode: first };
}

/** A generic panel name ("Season 1", "Temporada 2", "S03"): replaced by the localised label. */
const GENERIC_SEASON =
  /^\s*(?:season|temporada|saison|staffel|stagione|seizoen|s)\s*\.?\s*\d+\s*$/i;

/** The panel's own season name when it says more than "Season N" (SER-02 AC2). */
export function customSeasonName(season: Pick<Season, 'name'>): string | undefined {
  const name = season.name?.trim();
  return name && !GENERIC_SEASON.test(name) ? name : undefined;
}
