// Data of the Home and Favorites screens (FAV-01, FAV-02, FAV-03): the active list's favorites,
// recent channels and "Continue watching", resolved against the catalogue into display cards.
//
// - Recent channels (FAV-02 AC1): the history keeps one entry per channel (no duplicates); the
//   most recent first, at most `LIVE_RECENT_LIMIT` (`@/ui/routes/live`, as Live "Recent"). Channels that left the list are skipped.
// - Continue watching (FAV-02 AC2), most recent first, at most `CONTINUE_WATCHING_LIMIT`, with the
//   VOD-03 rules (`@/ui/vod/resume`): movies with a resumable position (1 min to 95 %, not
//   completed); series whose entry points at an episode to watch (`episodeKey`: the one in
//   progress, or the next one after a finished episode, SER-03) until the last one is finished.
//   The per-episode entries (SER-02/03, `isEpisodeItemKey`) are the series' own bookkeeping.
// - Favorites (FAV-01 AC2/AC3): those of the active list only; a favorite whose item is no longer
//   in the catalogue (removed by a re-sync) is kept and reported as unavailable.
// - Protected content (UX-07): cards of DRM/DASH items carry `protected` (badge); with Settings ›
//   Playback "Hide protected content" on, Home leaves them out of its rows. The recent and
//   "Continue watching" rows are read with their usual limit first and filtered after, so a row
//   may show fewer cards than its limit (those items can't be played anyway). The Favorites
//   screen keeps showing them, marked: they are the user's own choices.
import {
  catalogRepo,
  favoritesRepo,
  historyRepo,
  isEpisodeItemKey,
  isProtectedItem,
  parseCategoryKey,
  settingsRepo,
  type CatalogItemByType,
  type ContentType,
  type Favorite,
  type HistoryEntry,
} from '@/core/db';
import { LIVE_RECENT_LIMIT, liveChannelPath } from '@/ui/routes/live';
import {
  RESUME_MIN_SEC,
  continueWatchingProgress,
  watchedFraction,
  type ContinueWatchingProgress,
} from '@/ui/vod/resume';

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
  /** Protected content (DRM/DASH, UX-07): shown with the "Protected" badge. */
  protected?: boolean | undefined;
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
  const card: CardItem = {
    key: item.key,
    type: item.type,
    name: item.name,
    image,
    href: itemHref(item),
  };
  if (isProtectedItem(item)) card.protected = true;
  return card;
}

/** Cards without the protected ones when `hide` is on (UX-07). */
function visible(cards: CardItem[], hide: boolean): CardItem[] {
  return hide ? cards.filter((card) => card.protected !== true) : cards;
}

/**
 * Whether the entry belongs in "Continue watching" (FAV-02 AC2), else undefined. Movies follow the
 * shared rule (`continueWatchingProgress`: worth resuming). A series' own entry points at the
 * episode to watch: shown at position 0 (the next episode after a finished one, SER-03, no bar)
 * or once the episode in progress reaches the VOD-03 minimum (1 min) — not dropped above 95 %
 * while the series is not finished (the episode's own completion moves the pointer on).
 */
export function continueWatching(entry: HistoryEntry): ContinueWatchingProgress | undefined {
  if (entry.completed) return undefined;
  switch (entry.type) {
    case 'movie':
      return continueWatchingProgress(entry);
    case 'series':
      if (isEpisodeItemKey(entry.itemKey) || entry.episodeKey === undefined) return undefined;
      if (entry.positionSec !== 0 && !((entry.positionSec ?? 0) >= RESUME_MIN_SEC)) {
        return undefined;
      }
      return { fraction: watchedFraction(entry) };
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
    limit: LIVE_RECENT_LIMIT,
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

/**
 * Available favorites of every type, most recently added first (Home row); without protected ones
 * when `hideProtected` (UX-07).
 */
export async function loadHomeFavorites(
  sourceId: string,
  hideProtected = false,
): Promise<CardItem[]> {
  return homeFavoritesRow(await availableFavorites(sourceId), hideProtected);
}

/** Available favorites of every type, most recently added first (all of them). */
async function availableFavorites(sourceId: string): Promise<CardItem[]> {
  const lists = await Promise.all(
    (['live', 'movie', 'series'] as const).map((type) => loadFavorites(sourceId, type)),
  );
  return lists
    .flat()
    .filter((entry): entry is FavoriteEntry & { card: CardItem } => entry.card !== undefined)
    .sort((a, b) => b.favorite.addedAt - a.favorite.addedAt)
    .map((entry) => entry.card);
}

function homeFavoritesRow(cards: CardItem[], hideProtected: boolean): CardItem[] {
  return visible(cards, hideProtected).slice(0, HOME_FAVORITES_LIMIT);
}

export interface HomeData {
  continueWatching: CardItem[];
  recentChannels: CardItem[];
  favorites: CardItem[];
  /** Whether the list has any history to clear (also completed or unresolvable entries). */
  hasHistory: boolean;
}

export async function loadHome(sourceId: string): Promise<HomeData> {
  // The setting is read with the rows (one round of reads); the rows are filtered after.
  const [continueWatching, recentChannels, favorites, hideSetting] = await Promise.all([
    continueWatchingRow(sourceId),
    recentChannelsRow(sourceId),
    availableFavorites(sourceId),
    settingsRepo.get('hideProtectedContent'),
  ]);
  const hide = hideSetting === true;
  return {
    continueWatching: visible(continueWatching.cards, hide),
    recentChannels: visible(recentChannels.cards, hide),
    favorites: homeFavoritesRow(favorites, hide),
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
