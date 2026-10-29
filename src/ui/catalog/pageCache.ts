// Page cache of the virtualised catalogue lists and grids (LIV-01 AC2, VOD-01; shared since
// TEC-02). Rows are read from a `PageSource` in pages of `pageSize` as the viewport reaches them,
// and at most `maxPages` pages are kept: the farthest from the viewport are evicted, so memory
// stays bounded however far the user scrolls. A page is never requested again while it is cached
// or in flight.
//
// The page of each active (keyboard-selected) row is pinned: it is loaded, never evicted (so
// Enter/F keep working on it) and not re-read every time the viewport moves away from it. Pins do
// not move the eviction centre: only the viewport does.
//
// Several lists may share one cache (Live's main list and the "Channels" panel over the player,
// LIV-02): each subscribes and pins its own active row (one pin per owner); the cache stops
// storing results only once the last subscriber has gone.
//
// No `@/core/db` import here (ADR-003: `src/ui` is checked as part of the initial bundle): the
// features pass their own readers.

/** Rows by position: `load(offset, limit)` returns the rows `[offset, offset + limit)`. */
export interface PageSource<T> {
  readonly total: number;
  /** A hole (`undefined`) is a row that is gone; it is not shifted onto the next one. */
  load(offset: number, limit: number): Promise<readonly (T | undefined)[]>;
}

/**
 * A page source over an ordered list of keys whose rows are read by key (e.g. from IndexedDB).
 * `loadByKeys` may omit missing keys: each row is placed at its own key's position.
 */
export function keyedPageSource<T extends { key: string }>(
  keys: readonly string[],
  loadByKeys: (keys: readonly string[]) => Promise<readonly T[]>,
): PageSource<T> {
  return {
    total: keys.length,
    load: async (offset, limit) => {
      const slice = keys.slice(offset, offset + limit);
      const rows = await loadByKeys(slice);
      const byKey = new Map(rows.map((row) => [row.key, row]));
      return slice.map((key) => byKey.get(key));
    },
  };
}

export class CatalogPageCache<T extends { key: string }> {
  private readonly pages = new Map<number, readonly (T | undefined)[]>();
  private readonly pending = new Set<number>();
  private readonly subscribers = new Set<{
    onChange: () => void;
    onError: ((error: unknown) => void) | undefined;
  }>();
  private center = 0;
  /** Pinned page per owner (each list pins its active row). */
  private readonly pinned = new Map<object, number>();

  constructor(
    /** Protected: a subclass may narrow its type (`declare`) instead of keeping a second copy. */
    protected readonly source: PageSource<T>,
    private readonly pageSize: number,
    private readonly maxPages: number,
  ) {}

  get total(): number {
    return this.source.total;
  }

  /** Number of cached pages (tests and diagnostics). */
  get cachedPages(): number {
    return this.pages.size;
  }

  /** The row at `index`, or `undefined` while its page is not loaded (or the row is gone). */
  get(index: number): T | undefined {
    return this.pages.get(Math.floor(index / this.pageSize))?.[index % this.pageSize];
  }

  /**
   * `onChange` is called after a page arrives, `onError` when one fails (it is read again next
   * time). Returns the unsubscribe function; with no subscriber left, pages still in flight are
   * dropped.
   */
  subscribe(onChange: () => void, onError?: (error: unknown) => void): () => void {
    const subscriber = { onChange, onError };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /** Index of the row `key` among the cached pages, or -1 (not cached or not here). */
  indexOf(key: string): number {
    for (const [page, rows] of this.pages) {
      const i = rows.findIndex((row) => row?.key === key);
      if (i >= 0) return page * this.pageSize + i;
    }
    return -1;
  }

  /**
   * The rows `[start, end]` are in the viewport: loads their missing pages, and eviction keeps
   * the pages closest to this range.
   */
  setViewport(start: number, end: number): void {
    const range = this.pageRange(start, end);
    if (!range) return;
    this.center = (range.first + range.last) / 2;
    this.loadPages(range.first, range.last);
  }

  /**
   * Keeps the page of row `index` (`owner`'s active row) loaded and never evicted, however far
   * the viewport moves; `undefined` (or an index out of range) unpins.
   */
  pin(index: number | undefined, owner: object = this): void {
    if (index === undefined || index < 0 || index >= this.total) {
      this.pinned.delete(owner);
      return;
    }
    const page = Math.floor(index / this.pageSize);
    this.pinned.set(owner, page);
    this.loadPages(page, page);
  }

  private pageRange(start: number, end: number): { first: number; last: number } | undefined {
    if (this.total === 0) return undefined;
    const first = Math.max(0, Math.floor(start / this.pageSize));
    const last = Math.min(
      Math.floor((this.total - 1) / this.pageSize),
      Math.floor(Math.max(start, end) / this.pageSize),
    );
    return first <= last ? { first, last } : undefined;
  }

  /** Starts reading every page in `[first, last]` that is neither cached nor in flight. */
  private loadPages(first: number, last: number): void {
    for (let page = first; page <= last; page++) {
      if (this.pages.has(page) || this.pending.has(page)) continue;
      this.pending.add(page);
      this.source.load(page * this.pageSize, this.pageSize).then(
        (rows) => {
          this.pending.delete(page);
          if (this.subscribers.size === 0) return;
          this.pages.set(page, rows);
          this.evict();
          for (const s of [...this.subscribers]) s.onChange();
        },
        (error: unknown) => {
          this.pending.delete(page);
          for (const s of [...this.subscribers]) s.onError?.(error);
        },
      );
    }
  }

  private evict(): void {
    const pinned = new Set(this.pinned.values());
    while (this.pages.size > this.maxPages) {
      let farthest = -1;
      let distance = -1;
      for (const page of this.pages.keys()) {
        if (pinned.has(page)) continue;
        const d = Math.abs(page - this.center);
        if (d > distance) {
          distance = d;
          farthest = page;
        }
      }
      if (farthest < 0) return;
      this.pages.delete(farthest);
    }
  }
}
