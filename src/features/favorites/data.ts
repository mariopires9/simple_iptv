// Data of the Home and Favorites screens (FAV-01, FAV-02, FAV-03): the active list's favorites,
// recent channels and "Continue watching", resolved against the catalogue into display cards.
//
// - Recent channels (FAV-02 AC1): the history keeps one entry per channel (no duplicates); the
//   most recent first, at most `RECENT_CHANNELS_LIMIT`. Channels that left the list are skipped.
// - Continue watching (FAV-02 AC2), most recent first, at most `CONTINUE_WATCHING_LIMIT`, with the
//   VOD-03 rules (`@/ui/vod/resume`): movies with a resumable position (1 min to 95 %, not
//   completed); series whose entry points at an episode to watch (`episodeKey`: the one in
//   progress, or the next one after a finished episode, SER-03) until the last one is finished.
//   The per-episode entries (SER-02/03, `isEpisodeItemKey`) are the series' own bookkeeping.
// - Favorites (FAV-01 AC2/AC3): those of the active list only; a favorite whose item is no longer
//   in the catalogue (removed by a re-sync) is kept and reported as unavailable.
import {
  catalogRepo,
  favoritesRepo,
  historyRepo,
  isEpisodeItemKey,
  parseCategoryKey,
  type CatalogItemByType,
  type ContentType,
  type Favorite,
  type HistoryEntry,
} from '@/core/db';
import { LIVE_RECENT_LIMIT, liveChannelPath } from '@/ui/routes/live';
import { continueWatchingProgress, type ContinueWatchingProgress } from '@/ui/vod/resume';

/** The same limit as Live "Recent" (FAV-02 AC1). */
export const RECENT_CHANNELS_LIMIT = LIVE_RECENT_LIMIT;
export const CONTINUE_WATCHING_LIMIT = 20;
/** Favorites shown on Home (all types, most recently added first); the rest via "See all". */
export const HOME_FAVORITES_LIMIT = 20;

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
  return liveChannelPath(category?.externalId, channel.key);
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

/** A "Continue watching" entry and its progress bar (`fraction` undefined: no bar). */
export type ContinueWatching = ContinueWatchingProgress;

/**
 * Whether the entry belongs in "Continue watching" (FAV-02 AC2), else undefined. Movies follow
 * the shared rule (`continueWatchingProgress`, also the Movies grid's bars). A series' own entry
 * follows it too for the episode in progress (a few seconds are not "watching" the series yet);
 * the one series-only case is position 0 on a not-yet-started next episode after a finished one
 * (SER-03), which is shown without a bar.
 */
export function continueWatching(entry: HistoryEntry): ContinueWatching | undefined {
  if (entry.completed) return undefined;
  switch (entry.type) {
    case 'movie':
      return continueWatchingProgress(entry);
    case 'series':
      if (isEpisodeItemKey(entry.itemKey) || entry.episodeKey === undefined) return undefined;
      if (entry.positionSec === 0) return { fraction: undefined };
      return continueWatchingProgress(entry);
    default:
      return undefined;
  }
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

/** Season/episode numbers of each entry's episode, when its series details are cached (one read). */
async function episodesOf(entries: readonly HistoryEntry[]): Promise<CardItem['episode'][]> {
  const details = await catalogRepo.getSeriesDetailsMany(entries.map((e) => e.itemKey));
  return entries.map((entry, i) => {
    if (entry.episodeKey === undefined) return undefined;
    for (const season of details[i]?.seasons ?? []) {
      const episode = season.episodes.find((e) => e.key === entry.episodeKey);
      if (episode) return { season: episode.season, number: episode.number };
    }
    return undefined;
  });
}

/** A Home row built from the history, plus whether any history entry was read. */
interface HistoryRow {
  cards: CardItem[];
  hasHistory: boolean;
}

async function recentChannelsRow(sourceId: string): Promise<HistoryRow> {
  const { items, scanned } = await historyRepo.listRecentItems(sourceId, ['live'], {
    limit: RECENT_CHANNELS_LIMIT,
  });
  return { cards: items.map(({ item }) => toCard(item)), hasHistory: scanned > 0 };
}

async function continueWatchingRow(sourceId: string): Promise<HistoryRow> {
  const { items, scanned } = await historyRepo.listRecentItems(sourceId, ['movie', 'series'], {
    limit: CONTINUE_WATCHING_LIMIT,
    accept: (entry) => continueWatching(entry) !== undefined,
  });
  const series = items.filter(({ entry }) => entry.type === 'series').map(({ entry }) => entry);
  const found = await episodesOf(series);
  const episodes = new Map(series.map((entry, i) => [entry.itemKey, found[i]]));
  const cards = items.map(({ entry, item }) => ({
    ...toCard(item),
    progress: continueWatching(entry)?.fraction,
    episode: entry.type === 'series' ? episodes.get(entry.itemKey) : undefined,
  }));
  return { cards, hasHistory: scanned > 0 };
}

/**
 * Recent channels: at most 30, most recent first, skipping channels no longer in the list (the
 * same rule as Live "Recent", via `historyRepo.listRecentItems`).
 */
export async function loadRecentChannels(sourceId: string): Promise<CardItem[]> {
  return (await recentChannelsRow(sourceId)).cards;
}

/** Continue watching: resumable movies and episodes, most recent first, at most 20. */
export async function loadContinueWatching(sourceId: string): Promise<CardItem[]> {
  return (await continueWatchingRow(sourceId)).cards;
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
  const [continueWatching, recentChannels, favorites] = await Promise.all([
    continueWatchingRow(sourceId),
    recentChannelsRow(sourceId),
    loadHomeFavorites(sourceId),
  ]);
  return {
    continueWatching: continueWatching.cards,
    recentChannels: recentChannels.cards,
    favorites,
    hasHistory: continueWatching.hasHistory || recentChannels.hasHistory,
  };
}

/** "Clear history" (FAV-02 AC3): the active list's history only; favorites are kept. */
export function clearHistory(sourceId: string): Promise<number> {
  return historyRepo.clearSource(sourceId);
}

export function removeFavorite(itemKey: string): Promise<void> {
  return favoritesRepo.remove(itemKey);
}
