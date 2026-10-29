// Sorting of the movie grid (VOD-01 AC2: Recently added · A–Z · Rating, without the network).
//
// Why in memory: the only ordered index over movies of a category is `[categoryKey+order]` (the
// source's own order). IndexedDB cannot sort a category by `addedAt`, name or rating without new
// compound indexes (a schema change, i.e. its own story — core/db is a serialized module), and
// sorting each fetched page on its own would not be a sort of the category at all.
//
// So the grid uses a compact *sort index*: each category is read once through the
// `[categoryKey+order]` index, and only `{ key, name, addedAt, rating, pos }` is kept per movie
// (no plot, poster or stream fields); that projection is sorted in memory. The grid then reads
// the full rows page by page by key (`getMany`), so at most a few pages of complete movies stay
// in memory. The projection is memoised per (source, sync, category) and each sorted order per
// projection, so switching sort or going back to a category does not read it again.
//
// Each category is read in ONE request, one category at a time: the peak is the full rows of the
// largest category, released right after projecting. Offset/limit chunks would bound that peak,
// but offsets over `[categoryKey+order]` are cursor walks (measured on fake-indexeddb: 10 000
// rows read with limit took ~25 s vs 36 ms for one unbounded read). A dedicated core/db read of
// the sort fields (or sort indexes per category) is the follow-up if large catalogues need it.
import { catalogRepo, type Movie } from '@/core/db';

export type SortMode = 'added' | 'name' | 'rating';
export const SORT_MODES: readonly SortMode[] = ['added', 'name', 'rating'];
export const DEFAULT_SORT: SortMode = 'added';

export function isSortMode(value: unknown): value is SortMode {
  return typeof value === 'string' && (SORT_MODES as readonly string[]).includes(value);
}

export interface SortRow {
  key: string;
  name: string;
  addedAt: number | undefined;
  rating: number | undefined;
  /** Position in the source's order (category order, then `order`): the tie-breaker. */
  pos: number;
}

export interface SortProjection {
  rows: readonly SortRow[];
  /** Some movie has a rating, so "Rating" is offered (VOD-01: "Rating when available"). */
  hasRatings: boolean;
}

function project(movie: Movie, pos: number): SortRow {
  return { key: movie.key, name: movie.name, addedAt: movie.addedAt, rating: movie.rating, pos };
}

/** Reads the projection of the given categories (in this order), one category at a time. */
export async function readProjection(categoryKeys: readonly string[]): Promise<SortProjection> {
  const rows: SortRow[] = [];
  let hasRatings = false;
  for (const key of categoryKeys) {
    const movies = await catalogRepo.listByCategory('movie', key);
    for (const movie of movies) {
      const row = project(movie, rows.length);
      if (row.rating !== undefined) hasRatings = true;
      rows.push(row);
    }
  }
  return { rows, hasRatings };
}

/** Projections kept in memory (the last few categories visited). */
export const MAX_PROJECTIONS = 4;
const projections = new Map<string, Promise<SortProjection>>();

/** Forgets the memoised projections (tests; a sync already invalidates them via `lastSyncAt`). */
export function clearProjectionCache(): void {
  projections.clear();
}

/**
 * The projection of `categoryKeys` of `sourceId`, memoised per (source, sync, categories). The
 * catalogue only changes on a sync, which moves `lastSyncAt`, so that timestamp is in the key.
 */
export function loadProjection(
  sourceId: string,
  syncStamp: number | undefined,
  categoryKeys: readonly string[],
): Promise<SortProjection> {
  const id = [sourceId, syncStamp ?? 'never', ...categoryKeys].join('\n');
  let found = projections.get(id);
  if (found) {
    // Most recently used last.
    projections.delete(id);
    projections.set(id, found);
    return found;
  }
  found = readProjection(categoryKeys);
  projections.set(id, found);
  // A failed read is not memoised: Retry reads again.
  found.catch(() => {
    if (projections.get(id) === found) projections.delete(id);
  });
  while (projections.size > MAX_PROJECTIONS) {
    const oldest = projections.keys().next().value;
    if (oldest === undefined) break;
    projections.delete(oldest);
  }
  return found;
}

function compareOptional(a: number | undefined, b: number | undefined): number {
  // Descending; missing values last.
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  return b - a;
}

const sorted = new WeakMap<readonly SortRow[], Map<string, readonly string[]>>();

/**
 * Keys of `rows` in `mode` order (memoised per rows array, mode and locale):
 * - `added`: newest first; movies without a date keep the source order, after the dated ones.
 * - `name`: locale-aware, case/accent-insensitive, numeric ("Movie 2" before "Movie 10").
 * - `rating`: highest first; unrated last.
 * Ties keep the source order.
 */
export function sortedKeys(
  rows: readonly SortRow[],
  mode: SortMode,
  locale: string,
): readonly string[] {
  let byMode = sorted.get(rows);
  if (!byMode) {
    byMode = new Map();
    sorted.set(rows, byMode);
  }
  const id = `${mode}\n${locale}`;
  const cached = byMode.get(id);
  if (cached) return cached;
  const list = [...rows];
  switch (mode) {
    case 'added':
      list.sort((a, b) => compareOptional(a.addedAt, b.addedAt) || a.pos - b.pos);
      break;
    case 'rating':
      list.sort((a, b) => compareOptional(a.rating, b.rating) || a.pos - b.pos);
      break;
    case 'name': {
      const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
      list.sort((a, b) => collator.compare(a.name, b.name) || a.pos - b.pos);
      break;
    }
  }
  const keys = list.map((r) => r.key);
  byMode.set(id, keys);
  return keys;
}
