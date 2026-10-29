// Page cache over a `ChannelPager` (LIV-01 AC2): rows are fetched in pages of `pageSize` as the
// viewport reaches them, and at most `maxPages` pages are kept (the farthest from the viewport
// are evicted), so memory stays bounded however far the user scrolls. The page of the active
// (keyboard-selected) row is pinned: it is never evicted, so Enter/F keep working on it and it is
// not re-read every time the viewport moves away from it.
//
// Several lists may share one cache (the main list and the "Channels" panel over the player,
// LIV-02): each subscribes and pins its own active row; the cache stops storing results only
// once the last subscriber has gone.
import type { Channel } from '@/core/db';
import type { ChannelPager } from './pagers';

export const PAGE_SIZE = 200;
export const MAX_PAGES = 8;

export class PageCache {
  private readonly pages = new Map<number, Channel[]>();
  private readonly pending = new Set<number>();
  private readonly subscribers = new Set<{
    onChange: () => void;
    onError: ((error: unknown) => void) | undefined;
  }>();
  private center = 0;
  /** Pinned page per owner (each list pins its active row). */
  private readonly pinned = new Map<object, number>();

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

  /**
   * `onChange` is called after a page arrives. Returns the unsubscribe function; with no
   * subscriber left, pages still in flight are dropped.
   */
  subscribe(onChange: () => void, onError?: (error: unknown) => void): () => void {
    const subscriber = { onChange, onError };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
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

  /** Keeps the page of row `index` cached for `owner` (its active row); `undefined` unpins. */
  pin(index: number | undefined, owner: object = this): void {
    if (index === undefined) this.pinned.delete(owner);
    else this.pinned.set(owner, Math.floor(index / this.pageSize));
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
    while (this.pages.size > this.maxPages) {
      let farthest = -1;
      let distance = -1;
      const pinned = new Set(this.pinned.values());
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
