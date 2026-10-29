// Data of the Home and Favorites screens (FAV-01, FAV-02, FAV-03): the active list's favorites,
// recent channels and "Continue watching", resolved against the catalogue into display cards.
//
// - Recent channels (FAV-02 AC1): the history keeps one entry per channel (no duplicates); the
//   most recent first, at most `RECENT_CHANNELS_LIMIT`. Channels that left the list are skipped.
// - Continue watching (FAV-02 AC2): movies and series (episodes) with a saved position between
//   `MIN_RESUME_SEC` and `MAX_RESUME_FRACTION` of the duration, not completed, most recent first,
//   at most `CONTINUE_WATCHING_LIMIT`.
// - Favorites (FAV-01 AC2/AC3): those of the active list only; a favorite whose item is no longer
//   in the catalogue (removed by a re-sync) is kept and reported as unavailable.
import {
  catalogRepo,
  favoritesRepo,
  historyRepo,
  parseCategoryKey,
  type CatalogItemByType,
  type ContentType,
  type Favorite,
  type HistoryEntry,
} from '@/core/db';

export const RECENT_CHANNELS_LIMIT = 30;
export const CONTINUE_WATCHING_LIMIT = 20;
/** Favorites shown on Home (all types, most recently added first); the rest via "See all". */
export const HOME_FAVORITES_LIMIT = 20;
export const MIN_RESUME_SEC = 60;
export const MAX_RESUME_FRACTION = 0.95;
/** Upper bound of history entries read per type (one indexed read each). */
const HISTORY_READ_LIMIT = 5_000;

/**
 * Live route id of "All" (features/live `VIRTUAL_CATEGORY_IDS.all`; features cannot import each
 * other): the category used for a channel without one.
 */
const LIVE_ALL_CATEGORY_ID = '~all';

/** One item as the screens show it. */
export interface CardItem {
  key: string;
  type: ContentType;
  name: string;
  image?: string | undefined;
  /** Route of the item: the channel in its category, or the movie/series details. */
  href: string;
  /** Watched fraction (0–1) for "Continue watching". */
  progress?: number | undefined;
  /** Season/episode to resume (series in "Continue watching"). */
  episode?: { season: number; number: number } | undefined;
}

/** Route of a channel: its own category with the channel selected (LIV-03 `?channel=`). */
export function channelHref(channel: CatalogItemByType['live']): string {
  const category =
    channel.categoryKey === undefined ? undefined : parseCategoryKey(channel.categoryKey);
  const categoryId = category?.externalId ?? LIVE_ALL_CATEGORY_ID;
  return `/live/category/${encodeURIComponent(categoryId)}?channel=${encodeURIComponent(channel.key)}`;
}

export function itemHref(item: CatalogItemByType[ContentType]): string {
  switch (item.type) {
    case 'live':
      return channelHref(item);
    case 'movie':
      return `/movies/${encodeURIComponent(item.externalId)}`;
    case 'series':
      return `/series/${encodeURIComponent(item.externalId)}`;
  }
}

export function toCard(item: CatalogItemByType[ContentType]): CardItem {
  const image = item.type === 'live' ? item.logo : item.type === 'movie' ? item.poster : item.cover;
  return { key: item.key, type: item.type, name: item.name, image, href: itemHref(item) };
}

/** Watched fraction when the entry belongs in "Continue watching" (FAV-02 AC2), else undefined. */
export function resumeFraction(entry: HistoryEntry): number | undefined {
  if (entry.completed) return undefined;
  const { positionSec, durationSec } = entry;
  if (positionSec === undefined || durationSec === undefined) return undefined;
  if (!(durationSec > 0) || !(positionSec >= MIN_RESUME_SEC)) return undefined;
  const fraction = positionSec / durationSec;
  return fraction < MAX_RESUME_FRACTION ? fraction : undefined;
}

/** Catalogue items by key (missing ones absent). */
async function itemsByKey<T extends ContentType>(
  type: T,
  keys: readonly string[],
): Promise<Map<string, CatalogItemByType[T]>> {
  if (keys.length === 0) return new Map();
  const items = await catalogRepo.getMany(type, keys);
  return new Map(items.map((item) => [item.key, item]));
}

/** Season/episode numbers of the episode to resume, when the series details are cached. */
async function episodeOf(entry: HistoryEntry): Promise<CardItem['episode']> {
  if (entry.episodeKey === undefined) return undefined;
  const details = await catalogRepo.getSeriesDetails(entry.itemKey);
  for (const season of details?.seasons ?? []) {
    const episode = season.episodes.find((e) => e.key === entry.episodeKey);
    if (episode) return { season: episode.season, number: episode.number };
  }
  return undefined;
}

export async function loadRecentChannels(sourceId: string): Promise<CardItem[]> {
  const recent = await historyRepo.listRecent(sourceId, 'live', HISTORY_READ_LIMIT);
  const channels = await itemsByKey(
    'live',
    recent.map((h) => h.itemKey),
  );
  const cards: CardItem[] = [];
  for (const entry of recent) {
    const channel = channels.get(entry.itemKey);
    if (channel) cards.push(toCard(channel));
    if (cards.length === RECENT_CHANNELS_LIMIT) break;
  }
  return cards;
}

export async function loadContinueWatching(sourceId: string): Promise<CardItem[]> {
  const [movies, series] = await Promise.all([
    historyRepo.listRecent(sourceId, 'movie', HISTORY_READ_LIMIT),
    historyRepo.listRecent(sourceId, 'series', HISTORY_READ_LIMIT),
  ]);
  const resumable = [...movies, ...series]
    .filter((entry) => resumeFraction(entry) !== undefined)
    .sort((a, b) => b.lastWatchedAt - a.lastWatchedAt);
  const [movieItems, seriesItems] = await Promise.all([
    itemsByKey(
      'movie',
      resumable.filter((e) => e.type === 'movie').map((e) => e.itemKey),
    ),
    itemsByKey(
      'series',
      resumable.filter((e) => e.type === 'series').map((e) => e.itemKey),
    ),
  ]);
  const shown: { entry: HistoryEntry; card: CardItem }[] = [];
  for (const entry of resumable) {
    const item =
      entry.type === 'movie' ? movieItems.get(entry.itemKey) : seriesItems.get(entry.itemKey);
    if (item) shown.push({ entry, card: { ...toCard(item), progress: resumeFraction(entry) } });
    if (shown.length === CONTINUE_WATCHING_LIMIT) break;
  }
  return Promise.all(
    shown.map(async ({ entry, card }) =>
      entry.type === 'series' ? { ...card, episode: await episodeOf(entry) } : card,
    ),
  );
}

/** A favorite of the Favorites screen: the item, or `undefined` when it left the list. */
export interface FavoriteEntry {
  favorite: Favorite;
  card: CardItem | undefined;
}

export async function loadFavorites(sourceId: string, type: ContentType): Promise<FavoriteEntry[]> {
  const favorites = await favoritesRepo.list(sourceId, type);
  const items = await itemsByKey(
    type,
    favorites.map((f) => f.itemKey),
  );
  return favorites.map((favorite) => {
    const item = items.get(favorite.itemKey);
    return { favorite, card: item ? toCard(item) : undefined };
  });
}

/** Available favorites of every type, most recently added first (Home row). */
export async function loadHomeFavorites(sourceId: string): Promise<CardItem[]> {
  const lists = await Promise.all(
    (['live', 'movie', 'series'] as const).map((type) => loadFavorites(sourceId, type)),
  );
  return lists
    .flat()
    .filter((entry): entry is FavoriteEntry & { card: CardItem } => entry.card !== undefined)
    .sort((a, b) => b.favorite.addedAt - a.favorite.addedAt)
    .slice(0, HOME_FAVORITES_LIMIT)
    .map((entry) => entry.card);
}

export interface HomeData {
  continueWatching: CardItem[];
  recentChannels: CardItem[];
  favorites: CardItem[];
  /** Whether the list has any history to clear (also completed or unresolvable entries). */
  hasHistory: boolean;
}

export async function loadHome(sourceId: string): Promise<HomeData> {
  const [continueWatching, recentChannels, favorites, hasHistory] = await Promise.all([
    loadContinueWatching(sourceId),
    loadRecentChannels(sourceId),
    loadHomeFavorites(sourceId),
    hasAnyHistory(sourceId),
  ]);
  return { continueWatching, recentChannels, favorites, hasHistory };
}

async function hasAnyHistory(sourceId: string): Promise<boolean> {
  const lists = await Promise.all(
    (['live', 'movie', 'series'] as const).map((type) => historyRepo.listRecent(sourceId, type, 1)),
  );
  return lists.some((list) => list.length > 0);
}

/** "Clear history" (FAV-02 AC3): the active list's history only; favorites are kept. */
export function clearHistory(sourceId: string): Promise<number> {
  return historyRepo.clearSource(sourceId);
}

export function removeFavorite(itemKey: string): Promise<void> {
  return favoritesRepo.remove(itemKey);
}
