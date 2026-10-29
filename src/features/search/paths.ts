// Where a search result leads (SCH-02 AC3): a channel plays in Live (its category, `?channel=`),
// a movie or a series opens its details.
import type { SearchHit } from '@/worker';

/**
 * Route id of Live's "All" category (`VIRTUAL_CATEGORY_IDS.all` in features/live/categories.ts;
 * features do not import each other), used for channels without a category.
 */
export const LIVE_ALL_CATEGORY_ID = '~all';

export function resultPath(
  hit: Pick<SearchHit, 'type' | 'key' | 'externalId' | 'categoryId'>,
): string {
  switch (hit.type) {
    case 'live': {
      const category = encodeURIComponent(hit.categoryId ?? LIVE_ALL_CATEGORY_ID);
      return `/live/category/${category}?channel=${encodeURIComponent(hit.key)}`;
    }
    case 'movie':
      return `/movies/${encodeURIComponent(hit.externalId)}`;
    case 'series':
      return `/series/${encodeURIComponent(hit.externalId)}`;
  }
}
