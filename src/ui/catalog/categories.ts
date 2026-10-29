// Categories of the poster-grid screens (VOD-01 AC1, SER-01): "All" first, then the source's own
// categories in their original order; the synthetic "Uncategorized" category (empty name, SRC-04
// AC9) gets the feature's localised name. Shared since SER-01.
import type { Category } from '@/core/db';
import { UNCATEGORIZED_CATEGORY_ID } from '@/providers/m3u';

/** Route id of "All"; the `~` prefix keeps it apart from provider ids (Xtream ids are numeric). */
export const ALL_CATEGORY_ID = '~all';

export type CatalogCategory =
  | { kind: 'all'; id: string; name: string }
  | { kind: 'source'; id: string; name: string; key: string };

export interface CategoryNames {
  /** Name of the virtual "All" category. */
  all: string;
  /** Name of the synthetic category of entries without one. */
  uncategorized: string;
}

export function buildCatalogCategories(
  sourceCategories: readonly Category[],
  names: CategoryNames,
): CatalogCategory[] {
  const own: CatalogCategory[] = [...sourceCategories]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      kind: 'source',
      id: c.externalId,
      name:
        c.externalId === UNCATEGORIZED_CATEGORY_ID && c.name === '' ? names.uncategorized : c.name,
      key: c.key,
    }));
  return [{ kind: 'all', id: ALL_CATEGORY_ID, name: names.all }, ...own];
}

export interface CatalogPaths {
  /** Route path that selects a category (`base` for "All"). */
  categoryPath: (id: string) => string;
  /** Route path of an item's details. */
  itemPath: (externalId: string) => string;
}

/** Paths of a catalogue section mounted at `base` (`/movies`, `/series`). */
export function catalogPaths(base: string): CatalogPaths {
  return {
    categoryPath: (id) =>
      id === ALL_CATEGORY_ID ? base : `${base}/category/${encodeURIComponent(id)}`,
    itemPath: (externalId) => `${base}/${encodeURIComponent(externalId)}`,
  };
}
