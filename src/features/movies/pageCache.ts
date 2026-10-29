// Page cache of the movie grid (VOD-01): the grid's order is a list of keys (see sortIndex.ts);
// full movie rows are read from IndexedDB a page at a time, by key, as the viewport reaches
// them, and at most `maxPages` pages are kept (the farthest from the viewport are evicted).
// Adapted from features/live/pageCache.ts (features cannot import each other; candidate for a
// shared extraction later).
import { catalogRepo, type Movie } from '@/core/db';

export const PAGE_SIZE = 120;
export const MAX_PAGES = 6;

export type LoadMovies = (keys: readonly string[]) => Promise<Movie[]>;

const loadByKeys: LoadMovies = (keys) => catalogRepo.getMany('movie', keys);

export class MoviePageCache {
  private readonly pages = new Map<number, Map<number, Movie>>();
  private readonly pending = new Set<number>();
  private readonly subscribers = new Set<{
    onChange: () => void;
    onError: ((error: unknown) => void) | undefined;
  }>();
  private center = 0;
  /** Page of the active cell: never evicted. */
  private pinned: number | undefined;

  constructor(
    readonly keys: readonly string[],
    private readonly load: LoadMovies = loadByKeys,
    private readonly pageSize = PAGE_SIZE,
    private readonly maxPages = MAX_PAGES,
  ) {}

  get total(): number {
    return this.keys.length;
  }

  /** Number of cached pages (tests and diagnostics). */
  get cachedPages(): number {
    return this.pages.size;
  }

  /** The movie at `index`, or `undefined` while its page is loading (or the row is gone). */
  get(index: number): Movie | undefined {
    return this.pages.get(Math.floor(index / this.pageSize))?.get(index);
  }

  subscribe(onChange: () => void, onError?: (error: unknown) => void): () => void {
    const subscriber = { onChange, onError };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /**
   * The items `[start, end]` are in the viewport: loads their missing pages, and eviction keeps
   * the pages closest to this range. Only the viewport moves the eviction centre.
   */
  setViewport(start: number, end: number): void {
    const range = this.pageRange(start, end);
    if (!range) return;
    this.center = (range.first + range.last) / 2;
    this.loadPages(range.first, range.last);
  }

  /**
   * Keeps the page of item `index` (the grid's active cell) loaded and never evicted, however far
   * the viewport moves; `undefined` unpins. A pinned page is read once, not on every scroll.
   */
  pin(index: number | undefined): void {
    if (index === undefined || index < 0 || index >= this.total) {
      this.pinned = undefined;
      return;
    }
    this.pinned = Math.floor(index / this.pageSize);
    this.loadPages(this.pinned, this.pinned);
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
      const from = page * this.pageSize;
      const keys = this.keys.slice(from, from + this.pageSize);
      this.load(keys).then(
        (movies) => {
          this.pending.delete(page);
          if (this.subscribers.size === 0) return;
          // `getMany` omits missing keys: place each row at its key's index.
          const byKey = new Map(movies.map((m) => [m.key, m]));
          const rows = new Map<number, Movie>();
          keys.forEach((key, i) => {
            const movie = byKey.get(key);
            if (movie) rows.set(from + i, movie);
          });
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
    while (this.pages.size > this.maxPages) {
      let farthest = -1;
      let distance = -1;
      for (const page of this.pages.keys()) {
        if (page === this.pinned) continue;
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
