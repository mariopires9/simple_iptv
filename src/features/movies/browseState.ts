// Where the user was browsing movies (VOD-01/02 review): the last category + query (sort), and
// the scroll position (as the first visible item) and active cell of each grid, kept in memory for the session so that
// "Back to movies" returns to the same place. Module state, not persisted: a reload starts over.

/** `location.state` of a details page opened from the grid: Back can simply go back. */
export const FROM_GRID = 'movies-grid';

export interface BrowseLocation {
  categoryId: string;
  /** Query string including `?`, or `''` (e.g. `?sort=name`). */
  search: string;
}

let lastBrowse: BrowseLocation | undefined;

export function rememberBrowse(location: BrowseLocation): void {
  lastBrowse = location;
}

export function lastBrowseLocation(): BrowseLocation | undefined {
  return lastBrowse;
}

export interface GridPosition {
  /** First item of the first visible row (independent of the column count). */
  topItem: number;
  active: number;
}

/** Grids remembered (the most recently used last). */
export const MAX_POSITIONS = 20;
const positions = new Map<string, GridPosition>();

export function saveGridPosition(key: string, position: GridPosition): void {
  positions.delete(key);
  positions.set(key, position);
  while (positions.size > MAX_POSITIONS) {
    const oldest = positions.keys().next().value;
    if (oldest === undefined) break;
    positions.delete(oldest);
  }
}

export function gridPosition(key: string): GridPosition | undefined {
  return positions.get(key);
}

/** Forgets everything (tests). */
export function clearBrowseState(): void {
  lastBrowse = undefined;
  positions.clear();
}
