// Composite catalog keys — docs/ARCHITECTURE.md §5.
// Item: `${sourceId}:${type}:${externalId}` · Category: `${sourceId}:${type}:cat:${externalId}`.
// They are deterministic: the same source produces the same keys on every sync,
// so favorites and history survive re-syncs.
import { CONTENT_TYPES, type ContentType } from './types';

const SEP = ':';
const CATEGORY_MARKER = 'cat';
const CATEGORY_PREFIX = `${CATEGORY_MARKER}${SEP}`;

export interface ParsedItemKey {
  sourceId: string;
  type: ContentType;
  externalId: string;
}

export type ParsedCategoryKey = ParsedItemKey;

function assertParts(sourceId: string, type: ContentType, externalId: string): void {
  if (sourceId === '' || sourceId.includes(SEP)) {
    throw new TypeError(`Invalid sourceId for composite key: "${sourceId}"`);
  }
  if (!CONTENT_TYPES.includes(type)) {
    throw new TypeError(`Invalid content type: "${String(type)}"`);
  }
  if (externalId === '') {
    throw new TypeError('Empty externalId in composite key');
  }
}

export function isContentType(value: string): value is ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * Key of a catalog item (channel, movie or series). An `externalId` starting with `cat:` is
 * rejected: the key would be indistinguishable from a category key.
 */
export function itemKey(sourceId: string, type: ContentType, externalId: string | number): string {
  const ext = String(externalId);
  assertParts(sourceId, type, ext);
  if (ext.startsWith(CATEGORY_PREFIX)) {
    throw new TypeError(`Item externalId must not start with "${CATEGORY_PREFIX}"`);
  }
  return `${sourceId}${SEP}${type}${SEP}${ext}`;
}

/** Key of a category. */
export function categoryKey(
  sourceId: string,
  type: ContentType,
  externalId: string | number,
): string {
  const ext = String(externalId);
  assertParts(sourceId, type, ext);
  return `${sourceId}${SEP}${type}${SEP}${CATEGORY_MARKER}${SEP}${ext}`;
}

/** Prefix shared by all keys of a source (useful for deleting by prefix). */
export function sourcePrefix(sourceId: string): string {
  return `${sourceId}${SEP}`;
}

/** Prefix shared by the item and category keys of a source+type. */
export function typePrefix(sourceId: string, type: ContentType): string {
  return `${sourceId}${SEP}${type}${SEP}`;
}

/** Splits `${sourceId}:${type}:${rest}` without validating the rest. */
function splitKey(key: string): ParsedItemKey | undefined {
  const first = key.indexOf(SEP);
  if (first <= 0) return undefined;
  const second = key.indexOf(SEP, first + 1);
  if (second < 0) return undefined;
  const type = key.slice(first + 1, second);
  if (!isContentType(type)) return undefined;
  return { sourceId: key.slice(0, first), type, externalId: key.slice(second + 1) };
}

/**
 * Parses an item key. The `externalId` may contain `:` (everything after the type).
 * Returns `undefined` if the key is invalid or is a category key (`…:cat:…`).
 */
export function parseItemKey(key: string): ParsedItemKey | undefined {
  const parsed = splitKey(key);
  if (!parsed || parsed.externalId === '' || parsed.externalId.startsWith(CATEGORY_PREFIX)) {
    return undefined;
  }
  return parsed;
}

/** Parses a category key; `undefined` if it is not a valid category key. */
export function parseCategoryKey(key: string): ParsedCategoryKey | undefined {
  const parsed = splitKey(key);
  if (!parsed || !parsed.externalId.startsWith(CATEGORY_PREFIX)) return undefined;
  const externalId = parsed.externalId.slice(CATEGORY_PREFIX.length);
  if (externalId === '') return undefined;
  return { ...parsed, externalId };
}

const EPISODE_MARKER = `${SEP}ep${SEP}`;

/**
 * Key of one episode of a series (SER-02/03): `${seriesKey}:ep:${episodeExternalId}`. It is a
 * valid item key of type `series` (the external id may contain `:`), so the episode's own
 * progress lives in `history` next to the series entry, which points at the current episode
 * through `episodeKey`. Consumers listing series history ("Continue watching") skip these
 * entries with {@link isEpisodeItemKey}.
 */
export function episodeItemKey(seriesKey: string, episodeExternalId: string | number): string {
  const series = parseItemKey(seriesKey);
  const ext = String(episodeExternalId);
  if (!series || series.type !== 'series' || isEpisodeItemKey(seriesKey)) {
    throw new TypeError(`Invalid series key: "${seriesKey}"`);
  }
  if (ext === '') throw new TypeError('Empty episode id');
  return `${seriesKey}${EPISODE_MARKER}${ext}`;
}

/** Whether `key` is an episode key ({@link episodeItemKey}), not a series or other item. */
export function isEpisodeItemKey(key: string): boolean {
  const parsed = parseItemKey(key);
  return parsed?.type === 'series' && parsed.externalId.includes(EPISODE_MARKER);
}

/**
 * Normalizes a name for search/sorting: lowercase, no diacritics, collapsed whitespace.
 * Only removes combining marks (`\p{M}`) after NFD; other symbols (e.g. `^`, `` ` ``) are kept.
 */
export function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Shortest search query, in letters and digits after normalization (SCH-01/SCH-02). */
export const MIN_SEARCH_QUERY_LENGTH = 2;

/**
 * Search words of a text (SCH-01): normalized (see `normalizeName`), split on anything that is not
 * a letter or a digit. Shared by the worker's index and the search screen.
 */
export function tokenizeSearchText(text: string): string[] {
  return normalizeName(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term !== '');
}

/** Whether a query has enough letters/digits to run a search (≥ {@link MIN_SEARCH_QUERY_LENGTH}). */
export function isSearchableQuery(query: string): boolean {
  return tokenizeSearchText(query).join('').length >= MIN_SEARCH_QUERY_LENGTH;
}
