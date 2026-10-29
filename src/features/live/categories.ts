// Live TV categories (LIV-01 AC1): three virtual categories ("Favorites", "Recent", "All")
// followed by the source's own categories in their original order.
import type { Category } from '@/core/db';
import { t } from '@/i18n';
import { UNCATEGORIZED_CATEGORY_ID } from '@/providers/m3u';

export type VirtualCategoryKind = 'favorites' | 'recent' | 'all';

/**
 * Route ids of the virtual categories. Source categories use their `externalId`; the `~` prefix
 * keeps the virtual ids apart from provider ids (Xtream ids are numeric).
 */
export const VIRTUAL_CATEGORY_IDS: Readonly<Record<VirtualCategoryKind, string>> = {
  favorites: '~favorites',
  recent: '~recent',
  all: '~all',
};

/** Category selected by `/live` (no category in the route). */
export const DEFAULT_CATEGORY_ID = VIRTUAL_CATEGORY_IDS.all;

export type LiveCategory =
  | { kind: VirtualCategoryKind; id: string; name: string }
  | { kind: 'source'; id: string; name: string; key: string };

const VIRTUAL_ORDER: readonly VirtualCategoryKind[] = ['favorites', 'recent', 'all'];

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
    id: VIRTUAL_CATEGORY_IDS[kind],
    name: t.live.virtualCategories[kind],
  }));
  const own: LiveCategory[] = [...sourceCategories]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ kind: 'source', id: c.externalId, name: categoryName(c), key: c.key }));
  return [...virtual, ...own];
}

/** Route path that selects a category. */
export function categoryPath(id: string): string {
  return `/live/category/${encodeURIComponent(id)}`;
}
