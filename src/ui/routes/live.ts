// Live TV routes (LIV-01, LIV-03) shared by every screen that links into Live: Live itself, Home
// and Favorites (FAV-01..03), Search (SCH-02). Features cannot import each other, so the route ids
// of Live's virtual categories and the "Recent" limit live here (TEC-03). No imports: this module
// may ride in the initial bundle.

export type LiveVirtualCategoryKind = 'favorites' | 'recent' | 'all';

/**
 * Route ids of Live's virtual categories. Source categories use their `externalId`; the `~` prefix
 * keeps the virtual ids apart from provider ids (Xtream ids are numeric).
 */
export const LIVE_VIRTUAL_CATEGORY_IDS: Readonly<Record<LiveVirtualCategoryKind, string>> = {
  favorites: '~favorites',
  recent: '~recent',
  all: '~all',
};

/** How many recently watched channels Live "Recent" and Home "Recent channels" show (FAV-02 AC1). */
export const LIVE_RECENT_LIMIT = 30;

/** Route path that selects a Live category. */
export function liveCategoryPath(categoryId: string): string {
  return `/live/category/${encodeURIComponent(categoryId)}`;
}

/** Query string that selects (plays) a channel in Live (LIV-03 `?channel=`). */
export function liveChannelSearch(channelKey: string): string {
  return `?channel=${encodeURIComponent(channelKey)}`;
}

/**
 * Route path of a channel in Live (LIV-03 `?channel=`): its own category, or "All" when it has none.
 */
export function liveChannelPath(categoryId: string | undefined, channelKey: string): string {
  return (
    liveCategoryPath(categoryId ?? LIVE_VIRTUAL_CATEGORY_IDS.all) + liveChannelSearch(channelKey)
  );
}
