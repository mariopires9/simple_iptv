// Movie categories (VOD-01 AC1): "All" first, then the source's own categories in their
// original order. Adapted from features/live/categories.ts (features cannot import each other;
// candidate for a shared extraction into src/ui or a catalogue helper later).
import type { Category } from '@/core/db';
import { t } from '@/i18n';
import { UNCATEGORIZED_CATEGORY_ID } from '@/providers/m3u';

/** Route id of "All"; the `~` prefix keeps it apart from provider ids (Xtream ids are numeric). */
export const ALL_CATEGORY_ID = '~all';

export type MovieCategory =
  | { kind: 'all'; id: string; name: string }
  | { kind: 'source'; id: string; name: string; key: string };

function categoryName(c: Category): string {
  return c.externalId === UNCATEGORIZED_CATEGORY_ID && c.name === ''
    ? t.movies.uncategorized
    : c.name;
}

export function buildCategories(sourceCategories: readonly Category[]): MovieCategory[] {
  const own: MovieCategory[] = [...sourceCategories]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ kind: 'source', id: c.externalId, name: categoryName(c), key: c.key }));
  return [{ kind: 'all', id: ALL_CATEGORY_ID, name: t.movies.all }, ...own];
}

/** Route path that selects a category (`/movies` for "All"). */
export function categoryPath(id: string): string {
  return id === ALL_CATEGORY_ID ? '/movies' : `/movies/category/${encodeURIComponent(id)}`;
}

/** Route path of a movie's details. */
export function moviePath(externalId: string): string {
  return `/movies/${encodeURIComponent(externalId)}`;
}
