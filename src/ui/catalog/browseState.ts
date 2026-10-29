// Where the user was browsing a poster grid (VOD-01/02 review; shared since SER-01): the last
// category + query (sort), and the scroll position (as the first visible item) and active cell of
// each grid, kept in memory for the session so that "Back to movies/series" returns to the same
// place. Module state, not persisted: a reload starts over. One instance per feature.

export interface BrowseLocation {
  categoryId: string;
  /** Query string including `?`, or `''` (e.g. `?sort=name`). */
  search: string;
}

export interface GridPosition {
  /** First item of the first visible row (independent of the column count). */
  topItem: number;
  active: number;
}

/** Grids remembered per feature (the most recently used last). */
export const MAX_POSITIONS = 20;

export interface BrowseState {
  /** `location.state.from` of a details page opened from the grid: Back can simply go back. */
  readonly fromGrid: string;
  remember(location: BrowseLocation): void;
  last(): BrowseLocation | undefined;
  savePosition(key: string, position: GridPosition): void;
  position(key: string): GridPosition | undefined;
  /** Forgets everything (tests). */
  clear(): void;
}

export function createBrowseState(fromGrid: string): BrowseState {
  let lastBrowse: BrowseLocation | undefined;
  const positions = new Map<string, GridPosition>();
  return {
    fromGrid,
    remember(location) {
      lastBrowse = location;
    },
    last: () => lastBrowse,
    savePosition(key, position) {
      positions.delete(key);
      positions.set(key, position);
      while (positions.size > MAX_POSITIONS) {
        const oldest = positions.keys().next().value;
        if (oldest === undefined) break;
        positions.delete(oldest);
      }
    },
    position: (key) => positions.get(key),
    clear() {
      lastBrowse = undefined;
      positions.clear();
    },
  };
}

/** Whether `state` (a `location.state`) says the page was opened from this grid. */
export function openedFromGrid(state: unknown, browse: BrowseState): boolean {
  return (state as { from?: unknown } | null)?.from === browse.fromGrid;
}
