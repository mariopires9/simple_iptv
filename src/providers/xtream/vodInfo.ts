// Xtream `get_vod_info` → movie details (VOD-02, RESEARCH.md §7, ADR-013).
//
// Panels answer with `{ info, movie_data }`; either may be an empty array when the movie is
// unknown, fields may be numbers or strings, null or missing. Everything is validated with
// tolerant Valibot schemas: an unusable field is simply omitted, never an error. Free text is
// returned as plain text (the UI renders it as text, never as HTML) and clipped.
//
// The request URL embeds the credentials; it is built and used by the client only (never logged).
import * as v from 'valibot';
import { parseExternalUrl } from '@/core/net';
import type { XtreamClient } from './client';
import { toExternalId, toYear } from './catalog';
import { toEpochMs, toInt, toNumber, toText } from './schemas';

export interface VodInfo {
  /** Display name from the panel (`info.name`, else `movie_data.name`). */
  name?: string;
  plot?: string;
  genre?: string;
  director?: string;
  cast?: string;
  /** Release year (from `releasedate`/`release_date`/`year`). */
  year?: number;
  /** 0–10, one decimal; 0 ("not rated") is omitted. */
  rating?: number;
  durationSec?: number;
  /** `http(s)` poster URL. */
  poster?: string;
  /** `http(s)` backdrop URL (first of `backdrop_path`). */
  backdrop?: string;
  /** Container extension from `movie_data` (`mp4`, `mkv`…). */
  ext?: string;
  /** Stream id from `movie_data`. */
  streamId?: string;
  /** Added timestamp (epoch ms) from `movie_data`. */
  addedAt?: number;
}

const MAX_TEXT = 4096;

function text(value: unknown): string | undefined {
  const t = toText(value);
  return t === undefined ? undefined : t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t;
}

/** Ratings are 0–10 on Xtream panels; 0 means "not rated". */
function toRating(value: unknown): number | undefined {
  const n = toNumber(value);
  return n !== undefined && n > 0 && n <= 10 ? Math.round(n * 10) / 10 : undefined;
}

function toExtension(value: unknown): string | undefined {
  const t = toText(value)?.toLowerCase().replace(/^\./, '');
  return t !== undefined && /^[a-z0-9]{1,5}$/.test(t) ? t : undefined;
}

/** `"01:42:05"`, `"1:42"` (h:mm) → seconds; anything else → undefined. */
function clockToSeconds(value: unknown): number | undefined {
  const t = toText(value);
  const match = t === undefined ? null : /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(t);
  if (!match) return undefined;
  const [, h, m, s] = match;
  const total = Number(h) * 3600 + Number(m) * 60 + Number(s ?? 0);
  return total > 0 ? total : undefined;
}

function toDuration(secs: unknown, clock: unknown): number | undefined {
  const n = toInt(secs);
  if (n !== undefined && n > 0) return n;
  return clockToSeconds(clock);
}

function toImage(value: unknown): string | undefined {
  const first = Array.isArray(value) ? (value as unknown[]).find((x) => toText(x)) : value;
  const t = toText(first);
  if (t === undefined) return undefined;
  const parsed = parseExternalUrl(t, 'image');
  return parsed.ok ? parsed.url.href : undefined;
}

/** An object, or `undefined` for anything else (panels send `[]` for "nothing"). */
const record = v.fallback(v.optional(v.record(v.string(), v.unknown())), undefined);

export const VodInfoResponseSchema = v.object({
  info: record,
  movie_data: record,
});

/** Maps a `get_vod_info` body; `undefined` when it is not a VOD info response at all. */
export function parseVodInfo(body: unknown): VodInfo | undefined {
  const result = v.safeParse(VodInfoResponseSchema, body);
  if (!result.success) return undefined;
  const info = result.output.info ?? {};
  const data = result.output.movie_data ?? {};
  const out: VodInfo = {};
  const set = <K extends keyof VodInfo>(key: K, value: VodInfo[K] | undefined) => {
    if (value !== undefined) out[key] = value;
  };
  set('name', text(info.name) ?? text(info.o_name) ?? text(data.name));
  set('plot', text(info.plot) ?? text(info.description));
  set('genre', text(info.genre));
  set('director', text(info.director));
  set('cast', text(info.cast) ?? text(info.actors));
  set('year', toYear(info.releasedate) ?? toYear(info.release_date) ?? toYear(info.year));
  set('rating', toRating(info.rating));
  set('durationSec', toDuration(info.duration_secs, info.duration));
  set('poster', toImage(info.movie_image) ?? toImage(info.cover_big));
  set('backdrop', toImage(info.backdrop_path));
  set('ext', toExtension(data.container_extension));
  set('streamId', toExternalId(data.stream_id));
  set('addedAt', toEpochMs(data.added));
  return out;
}

/** `player_api.php?action=get_vod_info&vod_id=…`, mapped. Network errors propagate (`NetError`). */
export async function fetchVodInfo(
  client: Pick<XtreamClient, 'call'>,
  vodId: string,
  signal?: AbortSignal,
): Promise<VodInfo> {
  const body = await client.call('get_vod_info', { vod_id: vodId }, signal);
  return parseVodInfo(body) ?? {};
}
