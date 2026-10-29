// Where a search result leads (SCH-02 AC3): a channel plays in Live (its category, `?channel=`),
// a movie or a series opens its details.
import { liveChannelPath } from '@/ui/routes/live';
import type { SearchHit } from '@/worker';

export function resultPath(
  hit: Pick<SearchHit, 'type' | 'key' | 'externalId' | 'categoryId'>,
): string {
  switch (hit.type) {
    case 'live':
      // Channels without a category open in Live's "All".
      return liveChannelPath(hit.categoryId, hit.key);
    case 'movie':
      return `/movies/${encodeURIComponent(hit.externalId)}`;
    case 'series':
      return `/series/${encodeURIComponent(hit.externalId)}`;
  }
}
