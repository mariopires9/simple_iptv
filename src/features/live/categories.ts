// Live TV categories (LIV-01 AC1): three virtual categories ("Favorites", "Recent", "All")
// followed by the source's own categories in their original order.
import type { Category } from '@/core/db';
import { t } from '@/i18n';
import { UNCATEGORIZED_CATEGORY_ID } from '@/providers/m3u';
import { LIVE_VIRTUAL_CATEGORY_IDS, type LiveVirtualCategoryKind } from '@/ui/routes/live';

/** Category selected by `/live` (no category in the route). */
export const DEFAULT_CATEGORY_ID = LIVE_VIRTUAL_CATEGORY_IDS.all;

export type LiveCategory =
  | {
      kind: LiveVirtualCategoryKind;
      id: string;
      name: string;
      /** "Favorites": shown with a star in the category navigation. */
      favorite: boolean;
    }
  | { kind: 'source'; id: string; name: string; key: string };

const VIRTUAL_ORDER: readonly LiveVirtualCategoryKind[] = ['favorites', 'recent', 'all'];

/** Display name: the synthetic M3U "Uncategorized" category is stored nameless and localised here. */
function categoryName(c: Category): string {
  return c.externalId === UNCATEGORIZED_CATEGORY_ID && c.name === ''
    ? t.live.uncategorized
    : c.name;
}

/** Virtual categories first, then the source categories sorted by their original `order`. */
export function buildCategories(sourceCategories: readonly Category[]): LiveCategory[] {
  const virtual: LiveCategory[] = VIRTUAL_ORDER.map((kind) => ({
    kind,
    id: LIVE_VIRTUAL_CATEGORY_IDS[kind],
    name: t.live.virtualCategories[kind],
    favorite: kind === 'favorites',
  }));
  const own: LiveCategory[] = [...sourceCategories]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ kind: 'source', id: c.externalId, name: categoryName(c), key: c.key }));
  return [...virtual, ...own];
}
