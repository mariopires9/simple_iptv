// Where the user was browsing series (SER-01): the Series instance of the shared browse memory,
// and the section's routes.
import { createBrowseState } from '@/ui/catalog/browseState';
import { catalogPaths } from '@/ui/catalog/categories';

export const seriesBrowse = createBrowseState('series-grid');

const paths = catalogPaths('/series');

/** Route path that selects a category (`/series` for "All"). */
export const categoryPath = paths.categoryPath;

/** Route path of a series' details. */
export const seriesPath = paths.itemPath;
