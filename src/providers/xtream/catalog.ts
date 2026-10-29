// Xtream catalogue responses → internal model (SRC-07, ARCHITECTURE.md §5, ADR-013).
//
// Every list is validated item by item with tolerant Valibot schemas: numbers may arrive as
// strings, fields may be null/empty/missing, unknown fields are dropped. An item without a usable
// id or name is skipped and counted; any other unusable field just becomes `undefined`.
//
// Stream references: only `id` (+ extension for VOD) is stored in `streamPath`; the playable URL
// (which embeds the credentials) is built in memory at play time (ARCHITECTURE.md §5 footnote).
// Live channels store the bare id: the container (`.ts`/`.m3u8`) is a per-source preference
// (`prefs.liveFormat`) applied by `resolveStream`.
import * as v from 'valibot';
import type { CatalogItemInput, CategoryInput, ContentType } from '@/core/db';
import { parseExternalUrl } from '@/core/net';
import { coerce as field, toEpochMs, toInt, toNumber, toText } from './schemas';

/** Non-negative integer id as a string (`1001`, `"1001"`); anything else → undefined. */
export function toExternalId(value: unknown): string | undefined {
  const text = toText(value);
  return text !== undefined && /^\d{1,19}$/.test(text) ? String(BigInt(text)) : undefined;
}

/** Category id: any non-empty text without control characters (panels use numbers as strings). */
function toCategoryId(value: unknown): string | undefined {
  const text = toText(value);
  // eslint-disable-next-line no-control-regex
  return text !== undefined && text.length <= 64 && !/[\u0000-\u001f]/.test(text)
    ? text
    : undefined;
}

const MIN_YEAR = 1888;
const MAX_YEAR = 2200;

/** `2024`, `"2024"`, `"2024-03-01"` → 2024; out of range or unparsable → undefined. */
export function toYear(value: unknown): number | undefined {
  const text = toText(value);
  if (text === undefined) return undefined;
  const match = /^(\d{4})(?:$|[-/.\s])/.exec(text);
  if (!match?.[1]) return undefined;
  const year = Number(match[1]);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : undefined;
}

/** Ratings are 0–10 on Xtream panels; 0 means "not rated". */
export function toRating(value: unknown): number | undefined {
  const n = toNumber(value);
  return n !== undefined && n > 0 && n <= 10 ? Math.round(n * 10) / 10 : undefined;
}

/** Container extension such as `mp4`/`mkv`, lowercased; anything odd → undefined. */
export function toExtension(value: unknown): string | undefined {
  const text = toText(value)?.toLowerCase().replace(/^\./, '');
  return text !== undefined && /^[a-z0-9]{1,5}$/.test(text) ? text : undefined;
}

export const MAX_TEXT = 4096;

/** Caps free text from the panel at {@link MAX_TEXT} characters. */
export function clip(text: string): string {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}

export const XtreamCategorySchema = v.object({
  category_id: field(toCategoryId),
  category_name: field(toText),
});

export const XtreamLiveStreamSchema = v.object({
  stream_id: field(toExternalId),
  name: field(toText),
  num: field(toInt),
  stream_icon: field(toText),
  epg_channel_id: field(toText),
  category_id: field(toCategoryId),
  tv_archive: field(toInt),
  tv_archive_duration: field(toInt),
});

export const XtreamVodStreamSchema = v.object({
  stream_id: field(toExternalId),
  name: field(toText),
  stream_icon: field(toText),
  rating: field((x) => toNumber(x)),
  year: field(toText),
  added: field(toEpochMs),
  category_id: field(toCategoryId),
  container_extension: field(toText),
  plot: field(toText),
  genre: field(toText),
});

export const XtreamSeriesSchema = v.object({
  series_id: field(toExternalId),
  name: field(toText),
  cover: field(toText),
  plot: field(toText),
  genre: field(toText),
  rating: field((x) => toNumber(x)),
  year: field(toText),
  releaseDate: field(toText),
  release_date: field(toText),
  category_id: field(toCategoryId),
});

export interface MapOptions {
  /**
   * Extra check for URLs that will be stored (logos, posters, covers). Return `false` to drop the
   * URL — e.g. because it embeds the account credentials. Default: accept.
   */
  isStorableUrl?: (href: string) => boolean;
}

/** Result of mapping one list: valid entries in the original order + number skipped. */
export interface Mapped<T> {
  items: T[];
  skipped: number;
}

function imageUrl(value: string | undefined, options: MapOptions): string | undefined {
  if (value === undefined) return undefined;
  const parsed = parseExternalUrl(value, 'image');
  if (!parsed.ok) return undefined;
  const href = parsed.url.href;
  return options.isStorableUrl && !options.isStorableUrl(href) ? undefined : href;
}

function mapList<S extends v.GenericSchema, T>(
  list: readonly unknown[],
  schema: S,
  map: (parsed: v.InferOutput<S>) => T | undefined,
): Mapped<T> {
  const items: T[] = [];
  let skipped = 0;
  for (const raw of list) {
    const result = v.safeParse(schema, raw);
    const item = result.success ? map(result.output) : undefined;
    if (item === undefined) skipped++;
    else items.push(item);
  }
  return { items, skipped };
}

/** `get_*_categories` → categories in the panel's order (the order becomes `Category.order`). */
export function mapCategories(list: readonly unknown[]): Mapped<CategoryInput> {
  return mapList(list, XtreamCategorySchema, (c) => {
    if (c.category_id === undefined || c.category_name === undefined) return undefined;
    return { externalId: c.category_id, name: clip(c.category_name) };
  });
}

/** `get_live_streams` → channels. */
export function mapLiveStreams(
  list: readonly unknown[],
  options: MapOptions = {},
): Mapped<CatalogItemInput<'live'>> {
  return mapList(list, XtreamLiveStreamSchema, (s) => {
    if (s.stream_id === undefined || s.name === undefined) return undefined;
    const item: CatalogItemInput<'live'> = {
      externalId: s.stream_id,
      name: clip(s.name),
      streamPath: s.stream_id,
    };
    const logo = imageUrl(s.stream_icon, options);
    if (logo !== undefined) item.logo = logo;
    if (s.num !== undefined && s.num > 0) item.number = s.num;
    if (s.epg_channel_id !== undefined) item.epgId = clip(s.epg_channel_id);
    if (s.category_id !== undefined) item.categoryExternalId = s.category_id;
    if (s.tv_archive !== undefined && s.tv_archive > 0) {
      const days = s.tv_archive_duration;
      item.catchup = days !== undefined && days > 0 ? { days } : {};
    }
    return item;
  });
}

/** `get_vod_streams` → movies. */
export function mapVodStreams(
  list: readonly unknown[],
  options: MapOptions = {},
): Mapped<CatalogItemInput<'movie'>> {
  return mapList(list, XtreamVodStreamSchema, (s) => {
    if (s.stream_id === undefined || s.name === undefined) return undefined;
    const ext = toExtension(s.container_extension);
    const item: CatalogItemInput<'movie'> = {
      externalId: s.stream_id,
      name: clip(s.name),
      streamPath: ext !== undefined ? `${s.stream_id}.${ext}` : s.stream_id,
    };
    if (ext !== undefined) item.ext = ext;
    const poster = imageUrl(s.stream_icon, options);
    if (poster !== undefined) item.poster = poster;
    const rating = toRating(s.rating);
    if (rating !== undefined) item.rating = rating;
    const year = toYear(s.year);
    if (year !== undefined) item.year = year;
    if (s.added !== undefined) item.addedAt = s.added;
    if (s.plot !== undefined) item.plot = clip(s.plot);
    if (s.genre !== undefined) item.genre = clip(s.genre);
    if (s.category_id !== undefined) item.categoryExternalId = s.category_id;
    return item;
  });
}

/** `get_series` → series. */
export function mapSeries(
  list: readonly unknown[],
  options: MapOptions = {},
): Mapped<CatalogItemInput<'series'>> {
  return mapList(list, XtreamSeriesSchema, (s) => {
    if (s.series_id === undefined || s.name === undefined) return undefined;
    const item: CatalogItemInput<'series'> = {
      externalId: s.series_id,
      name: clip(s.name),
    };
    const cover = imageUrl(s.cover, options);
    if (cover !== undefined) item.cover = cover;
    if (s.plot !== undefined) item.plot = clip(s.plot);
    if (s.genre !== undefined) item.genre = clip(s.genre);
    const rating = toRating(s.rating);
    if (rating !== undefined) item.rating = rating;
    const year = toYear(s.year) ?? toYear(s.releaseDate) ?? toYear(s.release_date);
    if (year !== undefined) item.year = year;
    if (s.category_id !== undefined) item.categoryExternalId = s.category_id;
    return item;
  });
}

/** Xtream actions per content type. */
export const XTREAM_CATALOG_ACTIONS: Record<ContentType, { categories: string; items: string }> = {
  live: { categories: 'get_live_categories', items: 'get_live_streams' },
  movie: { categories: 'get_vod_categories', items: 'get_vod_streams' },
  series: { categories: 'get_series_categories', items: 'get_series' },
};

/**
 * Category id of items whose `category_id` is missing or not among the panel's categories. Same
 * convention as M3U lists (`UNCATEGORIZED_CATEGORY_ID` in providers/m3u, asserted equal in the
 * tests): stored with an empty, language-neutral name and localised by the UI.
 */
export const UNCATEGORIZED_CATEGORY_ID = 'uncategorized';

/**
 * Gives every item a known category so it is reachable from "All" (which walks the categories):
 * items without a (valid) category go to a synthetic {@link UNCATEGORIZED_CATEGORY_ID} category,
 * appended after the panel's categories only when needed.
 */
export function withUncategorized<T extends { categoryExternalId?: string }>(
  categories: readonly CategoryInput[],
  items: readonly T[],
): { categories: CategoryInput[]; items: T[] } {
  const known = new Set(categories.map((c) => c.externalId));
  let orphans = 0;
  const placed = items.map((item) => {
    const id = item.categoryExternalId;
    if (id !== undefined && known.has(id)) return item;
    orphans++;
    return { ...item, categoryExternalId: UNCATEGORIZED_CATEGORY_ID };
  });
  const out = [...categories];
  if (orphans > 0 && !known.has(UNCATEGORIZED_CATEGORY_ID)) {
    out.push({ externalId: UNCATEGORIZED_CATEGORY_ID, name: '' });
  }
  return { categories: out, items: placed };
}
