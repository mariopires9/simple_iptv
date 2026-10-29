// Seasons and episodes of a series (SER-02 AC1/AC4/AC5).
//
// - Xtream: `get_series_info` (both episode shapes normalised by `@/providers/xtream`), cached in
//   the `seriesDetails` table for 24 h. A cached record is only reused when it was fetched with
//   the same source identity (account fields + `lastSyncAt`, like the movie details): editing or
//   syncing the source refetches. A failed or aborted request is not cached.
// - M3U: no details endpoint. Shows grouped at import (VOD-04 AC3) have their seasons/episodes
//   stored with the catalogue (`seriesDetails` row written by the sync, replaced on every sync);
//   a series entry without an episode marker is its own only episode. Same UI, local data.
//
// The request needs the account password (vault → client only); nothing sensitive is logged.
import {
  catalogRepo,
  episodeItemKey,
  type Episode,
  type Season,
  type Series,
  type SeriesDetails,
  type Source,
} from '@/core/db';
import { log } from '@/core/log';
import { fetchSeriesInfo, type SeriesInfo } from '@/providers/xtream';
import { sourceIdentity } from '@/ui/vod/resolveVod';
import { xtreamClientFor, type XtreamClientDeps } from '@/ui/vod/xtreamClient';
import { parseEpisodeMarker } from './episodes';

export const DETAILS_TTL_MS = 24 * 60 * 60 * 1000;

export interface DetailsDeps extends XtreamClientDeps {
  now?: () => number;
}

/** The normalised answer as a `seriesDetails` record (episode keys derive from the series key). */
export function toSeriesDetails(
  series: Pick<Series, 'key' | 'sourceId'>,
  info: SeriesInfo,
  identity: string,
  fetchedAt: number,
): SeriesDetails {
  const seasons: Season[] = info.seasons.map((season) => ({
    number: season.number,
    ...(season.name !== undefined ? { name: season.name } : {}),
    ...(season.cover !== undefined ? { cover: season.cover } : {}),
    episodes: season.episodes.map((e) => {
      const episode: Episode = {
        key: episodeItemKey(series.key, e.externalId),
        externalId: e.externalId,
        season: e.season,
        number: e.number,
        title: e.title ?? '',
        streamPath: e.ext !== undefined ? `${e.externalId}.${e.ext}` : e.externalId,
      };
      if (e.ext !== undefined) episode.ext = e.ext;
      if (e.durationSec !== undefined) episode.durationSec = e.durationSec;
      if (e.plot !== undefined) episode.plot = e.plot;
      if (e.image !== undefined) episode.image = e.image;
      return episode;
    }),
  }));
  return {
    seriesKey: series.key,
    sourceId: series.sourceId,
    fetchedAt,
    seasons,
    identity,
    info: info.info,
  };
}

/** M3U series entry without stored episodes: the entry is its own (only) episode. */
export function localSeriesDetails(series: Series): SeriesDetails {
  const marker = parseEpisodeMarker(series.name);
  const season = marker?.season ?? 1;
  const episode: Episode = {
    key: episodeItemKey(series.key, series.externalId),
    externalId: series.externalId,
    season,
    number: marker?.episode ?? 1,
    title: series.name,
    streamPath: '',
  };
  return {
    seriesKey: series.key,
    sourceId: series.sourceId,
    fetchedAt: 0,
    seasons: [{ number: season, episodes: [episode] }],
  };
}

/**
 * Seasons and episodes of `series`: Xtream from the 24 h cache or the server, M3U from the entry.
 * Network and credential errors propagate (the screen shows them with a Retry).
 */
export async function loadSeriesDetails(
  source: Source,
  series: Series,
  deps: DetailsDeps = {},
): Promise<SeriesDetails> {
  if (source.kind !== 'xtream') {
    const stored = await catalogRepo.getSeriesDetails(series.key);
    return stored !== undefined && stored.seasons.length > 0 ? stored : localSeriesDetails(series);
  }
  const now = deps.now ?? Date.now;
  const identity = sourceIdentity(source);
  const cached = await catalogRepo.getSeriesDetails(series.key);
  if (cached?.identity === identity && now() - cached.fetchedAt < DETAILS_TTL_MS) return cached;
  const client = await xtreamClientFor(source, deps);
  const info = await fetchSeriesInfo(client, series.externalId, deps.signal);
  // An answer that arrives after the caller gave up is not trusted to be complete: not cached.
  deps.signal?.throwIfAborted();
  const details = toSeriesDetails(series, info, identity, now());
  try {
    await catalogRepo.putSeriesDetails(details);
    // The grid card's "N seasons" (SER-01), without reading the details per grid page.
    if (series.seasonCount !== details.seasons.length) {
      await catalogRepo.setSeasonCount(series.key, details.seasons.length);
    }
  } catch (error) {
    // The details still show; only the cache is lost.
    log.warn('series: caching the details failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
  }
  return details;
}
