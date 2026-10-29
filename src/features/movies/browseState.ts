// Where the user was browsing movies (VOD-01/02 review): the Movies instance of the shared
// browse memory (`@/ui/catalog/browseState`).
import { createBrowseState } from '@/ui/catalog/browseState';

export const moviesBrowse = createBrowseState('movies-grid');

/** `location.state` of a details page opened from the grid: Back can simply go back. */
export const FROM_GRID = moviesBrowse.fromGrid;
export const rememberBrowse = moviesBrowse.remember;
export const lastBrowseLocation = moviesBrowse.last;
/** Forgets everything (tests). */
export const clearBrowseState = moviesBrowse.clear;
