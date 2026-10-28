// Page cache over a `ChannelPager` (LIV-01 AC2): rows are fetched in pages of `pageSize` as the
// viewport reaches them, and at most `maxPages` pages are kept (the farthest from the viewport
// are evicted), so memory stays bounded however far the user scrolls. The page of the active
// (keyboard-selected) row is pinned: it is never evicted, so Enter/F keep working on it and it is
// not re-read every time the viewport moves away from it.
import type { Channel } from '@/core/db';
import type { ChannelPager } from './pagers';

export const PAGE_SIZE = 200;
export const MAX_PAGES = 8;

export class PageCache {
  private readonly pages = new Map<number, Channel[]>();
  private readonly pending = new Set<number>();
  private listener: (() => void) | undefined;
  private errorListener: ((error: unknown) => void) | undefined;
  private center = 0;
  private pinnedPage: number | undefined;
  private disposed = false;

  constructor(
    readonly pager: ChannelPager,
    private readonly pageSize = PAGE_SIZE,
    private readonly maxPages = MAX_PAGES,
  ) {}

  get total(): number {
    return this.pager.total;
  }

  /** Number of cached pages (tests and diagnostics). */
  get cachedPages(): number {
    return this.pages.size;
  }

  /** The channel at `index`, or `undefined` while its page is not loaded. */
  get(index: number): Channel | undefined {
    return this.pages.get(Math.floor(index / this.pageSize))?.[index % this.pageSize];
  }

  /** Called after a page arrives; returns the unsubscribe function (which disposes the cache). */
  subscribe(onChange: () => void, onError?: (error: unknown) => void): () => void {
    this.disposed = false;
    this.listener = onChange;
    this.errorListener = onError;
    return () => {
      this.disposed = true;
      this.listener = undefined;
      this.errorListener = undefined;
    };
  }

  /** Index of the channel `key` among the cached pages, or -1 (not cached or not here). */
  indexOf(key: string): number {
    for (const [page, rows] of this.pages) {
      const i = rows.findIndex((c) => c.key === key);
      if (i >= 0) return page * this.pageSize + i;
    }
    return -1;
  }

  /** Keeps the page of row `index` cached (the active row); `undefined` unpins. */
  pin(index: number | undefined): void {
    this.pinnedPage = index === undefined ? undefined : Math.floor(index / this.pageSize);
  }

  /** Loads every missing page that covers rows `[start, end]`. */
  ensure(start: number, end: number): void {
    if (this.total === 0) return;
    const first = Math.max(0, Math.floor(start / this.pageSize));
    const last = Math.min(
      Math.floor((this.total - 1) / this.pageSize),
      Math.floor(end / this.pageSize),
    );
    this.center = (first + last) / 2;
    for (let page = first; page <= last; page++) {
      if (this.pages.has(page) || this.pending.has(page)) continue;
      this.pending.add(page);
      this.pager.load(page * this.pageSize, this.pageSize).then(
        (rows) => {
          this.pending.delete(page);
          if (this.disposed) return;
          this.pages.set(page, rows);
          this.evict();
          this.listener?.();
        },
        (error: unknown) => {
          this.pending.delete(page);
          if (!this.disposed) this.errorListener?.(error);
        },
      );
    }
  }

  private evict(): void {
    while (this.pages.size > this.maxPages) {
      let farthest = -1;
      let distance = -1;
      for (const page of this.pages.keys()) {
        if (page === this.pinnedPage) continue;
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
