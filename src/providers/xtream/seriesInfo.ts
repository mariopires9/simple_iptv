// Xtream `get_series_info` → seasons and episodes (SER-02, RESEARCH.md §7, ADR-013).
//
// Panels answer `{ seasons, info, episodes }`, but the shapes vary (SER-02 AC5):
// - `episodes` keyed by season number (`{ "1": [...], "2": [...] }`) — the common shape;
// - `episodes` as an array of seasons (`[[...], [...]]`);
// - `episodes` as one flat array of episodes, each with its own `season`;
// - a season's episodes as an object keyed by index instead of an array;
// - `seasons` metadata may be missing, `[]`, or describe seasons without episodes.
// Everything is validated with tolerant schemas: an episode without a usable id is skipped, any
// other unusable field is simply omitted. Free text is clipped and stays plain text.
//
// The request URL embeds the credentials; it is built and used by the client only (never logged).
import * as v from 'valibot';
import type { SeriesDetailsInfo } from '@/core/db';
import type { XtreamClient } from './client';
import { toExtension, toExternalId, toRating, toYear } from './catalog';
import { toInt } from './schemas';
import { clippedText, toDuration, toImage } from './vodInfo';

export interface SeriesInfoEpisode {
  /** The episode's stream id (`id`), used in the stream URL. */
  externalId: string;
  season: number;
  number: number;
  /** Title without a leading `S01E02` marker; absent when nothing else is left. */
  title?: string;
  /** Container extension (`container_extension`). */
  ext?: string;
  durationSec?: number;
  plot?: string;
  /** `http(s)` still of the episode. */
  image?: string;
}

export interface SeriesInfoSeason {
  number: number;
  /** The panel's own name of the season (may be generic, e.g. "Season 1"). */
  name?: string;
  cover?: string;
  episodes: SeriesInfoEpisode[];
}

export interface SeriesInfo {
  info: SeriesDetailsInfo;
  /** Seasons with at least one episode, in ascending order; episodes by number. */
  seasons: SeriesInfoSeason[];
}

/** Upper bound of episodes read from one response (malformed or hostile answers). */
export const MAX_EPISODES = 5_000;
/** Seasons above this number are treated as invalid. */
const MAX_SEASON = 1_000;

const record = v.fallback(v.optional(v.record(v.string(), v.unknown())), undefined);
const list = v.fallback(v.optional(v.array(v.unknown())), undefined);

const SeriesInfoResponseSchema = v.object({
  info: record,
  seasons: list,
  episodes: v.fallback(v.optional(v.unknown()), undefined),
});

const EpisodeSchema = v.object({
  id: v.optional(v.unknown()),
  episode_num: v.optional(v.unknown()),
  title: v.optional(v.unknown()),
  container_extension: v.optional(v.unknown()),
  season: v.optional(v.unknown()),
  info: record,
});

const SeasonSchema = v.object({
  season_number: v.optional(v.unknown()),
  name: v.optional(v.unknown()),
  cover: v.optional(v.unknown()),
  cover_big: v.optional(v.unknown()),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function seasonNumber(value: unknown): number | undefined {
  const n = toInt(value);
  return n !== undefined && n >= 0 && n <= MAX_SEASON ? n : undefined;
}

/** A leading/embedded `S01E02` / `S1 E2` marker and the separator after it. */
const MARKER = /^(.*?)\bS\d{1,3}\s*E\d{1,4}\b\s*(?:[-–—:|.]\s*)?(.*)$/i;

/** `"S01E01 - Pilot"` → `"Pilot"`; `"S01E01"` → undefined; `"Pilot"` → `"Pilot"`. */
export function episodeTitle(raw: unknown): string | undefined {
  const text = clippedText(raw);
  if (text === undefined) return undefined;
  const match = MARKER.exec(text);
  if (!match) return text;
  const rest = (match[2] ?? '').trim();
  return rest === '' ? undefined : rest;
}

interface EpisodeGroup {
  /** Season of the group (object key, or array position + 1), when the shape gives one. */
  season: number | undefined;
  items: readonly unknown[];
}

/** The `episodes` field in any known shape → groups of raw episodes. */
function episodeGroups(raw: unknown): EpisodeGroup[] {
  const itemsOf = (value: unknown): readonly unknown[] =>
    Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
  if (Array.isArray(raw)) {
    if (raw.length > 0 && raw.every((x) => Array.isArray(x))) {
      return raw.map((items, i) => ({ season: i + 1, items: itemsOf(items) }));
    }
    // A flat list of episodes (each carries its own `season`).
    return [{ season: undefined, items: raw }];
  }
  if (isRecord(raw)) {
    return Object.entries(raw).map(([key, items]) => ({
      season: seasonNumber(key),
      items: itemsOf(items),
    }));
  }
  return [];
}

/** An episode whose number may still be missing (filled by its position in the season). */
type Draft = Omit<SeriesInfoEpisode, 'number'> & { number: number | undefined };

function mapEpisode(raw: unknown, group: EpisodeGroup): Draft | undefined {
  const parsed = v.safeParse(EpisodeSchema, raw);
  if (!parsed.success) return undefined;
  const e = parsed.output;
  const externalId = toExternalId(e.id);
  if (externalId === undefined) return undefined;
  const info = e.info ?? {};
  const num = toInt(e.episode_num);
  const episode: Draft = {
    externalId,
    season: seasonNumber(e.season) ?? group.season ?? 1,
    number: num !== undefined && num > 0 ? num : undefined,
  };
  const set = <K extends keyof Draft>(key: K, value: Draft[K] | undefined) => {
    if (value !== undefined) episode[key] = value;
  };
  set('title', episodeTitle(e.title));
  set('ext', toExtension(e.container_extension));
  set('durationSec', toDuration(info.duration_secs, info.duration));
  set('plot', clippedText(info.plot));
  set('image', toImage(info.movie_image) ?? toImage(info.cover_big));
  return episode;
}

function mapInfo(info: Record<string, unknown>): SeriesDetailsInfo {
  const out: SeriesDetailsInfo = {};
  const set = <K extends keyof SeriesDetailsInfo>(
    key: K,
    value: SeriesDetailsInfo[K] | undefined,
  ) => {
    if (value !== undefined) out[key] = value;
  };
  set('plot', clippedText(info.plot) ?? clippedText(info.description));
  set('genre', clippedText(info.genre));
  set('director', clippedText(info.director));
  set('cast', clippedText(info.cast) ?? clippedText(info.actors));
  set(
    'year',
    toYear(info.releaseDate) ??
      toYear(info.release_date) ??
      toYear(info.releasedate) ??
      toYear(info.year),
  );
  set('rating', toRating(info.rating));
  set('cover', toImage(info.cover) ?? toImage(info.cover_big));
  set('backdrop', toImage(info.backdrop_path));
  return out;
}

/** Maps a `get_series_info` body; `undefined` when it is not a series info response at all. */
export function parseSeriesInfo(body: unknown): SeriesInfo | undefined {
  const result = v.safeParse(SeriesInfoResponseSchema, body);
  if (!result.success) return undefined;
  const { info, seasons: seasonList, episodes } = result.output;

  const bySeason = new Map<number, Draft[]>();
  const seen = new Set<string>();
  let count = 0;
  for (const group of episodeGroups(episodes)) {
    group.items.forEach((raw) => {
      if (count >= MAX_EPISODES) return;
      const episode = mapEpisode(raw, group);
      if (!episode || seen.has(episode.externalId)) return;
      seen.add(episode.externalId);
      count++;
      const list = bySeason.get(episode.season) ?? [];
      list.push(episode);
      bySeason.set(episode.season, list);
    });
  }

  const meta = new Map<number, { name?: string; cover?: string }>();
  for (const raw of seasonList ?? []) {
    const parsed = v.safeParse(SeasonSchema, raw);
    if (!parsed.success) continue;
    const number = seasonNumber(parsed.output.season_number);
    if (number === undefined || meta.has(number)) continue;
    const entry: { name?: string; cover?: string } = {};
    const name = clippedText(parsed.output.name);
    if (name !== undefined) entry.name = name;
    const cover = toImage(parsed.output.cover) ?? toImage(parsed.output.cover_big);
    if (cover !== undefined) entry.cover = cover;
    meta.set(number, entry);
  }

  const seasons: SeriesInfoSeason[] = [...bySeason.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, list]) => ({
      number,
      ...meta.get(number),
      // A missing number is the position in the season; stable sort keeps the panel's order.
      episodes: list
        .map((e, i): SeriesInfoEpisode => ({ ...e, number: e.number ?? i + 1 }))
        .sort((a, b) => a.number - b.number),
    }));
  return { info: mapInfo(info ?? {}), seasons };
}

/**
 * `player_api.php?action=get_series_info&series_id=…`, mapped (an unusable body gives no seasons).
 * Network errors propagate (`NetError`).
 */
export async function fetchSeriesInfo(
  client: Pick<XtreamClient, 'call'>,
  seriesId: string,
  signal?: AbortSignal,
): Promise<SeriesInfo> {
  const body = await client.call('get_series_info', { series_id: seriesId }, signal);
  return parseSeriesInfo(body) ?? { info: {}, seasons: [] };
}
