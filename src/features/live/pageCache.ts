// Page cache of the channel list (LIV-01 AC2) over a `ChannelPager`: the shared catalogue cache
// (`@/ui/catalog/pageCache`: viewport paging, bounded memory, pinned active rows, several
// subscribers — the main list and the "Channels" panel over the player, LIV-02) plus the
// category's quick-filter index (LIV-04).
import type { Channel } from '@/core/db';
import { CatalogPageCache } from '@/ui/catalog/pageCache';
import { buildFilterIndex, type FilterIndex } from './channelFilter';
import type { ChannelPager } from './pagers';

export const PAGE_SIZE = 200;
export const MAX_PAGES = 8;

export class PageCache extends CatalogPageCache<Channel> {
  private filter: Promise<FilterIndex> | undefined;

  constructor(
    readonly pager: ChannelPager,
    pageSize = PAGE_SIZE,
    maxPages = MAX_PAGES,
  ) {
    super(pager, pageSize, maxPages);
  }

  /**
   * The category's quick-filter index (LIV-04), built on first use and then kept with this cache
   * (one per category and sync). A failed build is not kept, so the next use tries again.
   */
  filterIndex(): Promise<FilterIndex> {
    if (!this.filter) {
      const building = buildFilterIndex(this.pager);
      this.filter = building;
      building.catch(() => {
        if (this.filter === building) this.filter = undefined;
      });
    }
    return this.filter;
  }
}
