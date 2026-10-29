// Movie categories and paths (VOD-01 AC1): the shared catalogue helpers (`@/ui/catalog`) with the
// Movies names and routes.
import type { Category } from '@/core/db';
import { t } from '@/i18n';
import {
  ALL_CATEGORY_ID,
  buildCatalogCategories,
  catalogPaths,
  type CatalogCategory,
} from '@/ui/catalog/categories';

export { ALL_CATEGORY_ID };
export type MovieCategory = CatalogCategory;

export function buildCategories(sourceCategories: readonly Category[]): MovieCategory[] {
  return buildCatalogCategories(sourceCategories, {
    all: t.movies.all,
    uncategorized: t.movies.uncategorized,
  });
}

const paths = catalogPaths('/movies');

/** Route path that selects a category (`/movies` for "All"). */
export const categoryPath = paths.categoryPath;

/** Route path of a movie's details. */
export const moviePath = paths.itemPath;
