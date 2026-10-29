// One-time key migration of user data when M3U series entries are grouped into shows (VOD-04).
//
// Before VOD-04 every M3U series entry was a series row of its own (`<src>:series:<entryId>`),
// played as its only episode (`<src>:series:<entryId>:ep:<entryId>`). Grouped, the same entry is
// episode `<entryId>` of a show (`<src>:series:<showId>`, episode key
// `episodeItemKey(showKey, entryId)`). History and favourites saved under the old keys are moved:
// - the old episode entry → the new episode entry;
// - the old series entry → the new episode entry (when there was no episode entry) and the
//   show's entry pointing at that episode, when it is the most recent one of the show;
// - a favourite → the show's favourite (one per show, the earliest `addedAt` kept).
// Old keys are deleted, so running it again finds nothing to do (idempotent). Only keys that exist
// are touched; it runs inside the catalogue write transaction (`replaceAllForExistingSource`).
import { episodeItemKey, itemKey } from '../keys';
import type { SimpleIptvDb } from '../schema';
import type { Favorite, HistoryEntry, SeriesDetails } from '../types';

interface Move {
  showKey: string;
  episodeKey: string;
}

export interface RegroupResult {
  /** History entries moved. */
  history: number;
  /** Favourites moved. */
  favorites: number;
}

const EPISODE_MARKER = ':ep:';

/** Old per-entry series key → new show and episode keys, for every stored episode. */
function movesOf(
  sourceId: string,
  details: readonly SeriesDetails[],
  currentSeriesKeys: ReadonlySet<string>,
): Map<string, Move> {
  const moves = new Map<string, Move>();
  for (const { seriesKey, seasons } of details) {
    for (const season of seasons) {
      for (const episode of season.episodes) {
        const oldKey = itemKey(sourceId, 'series', episode.externalId);
        // Still (or again) a series row of its own: nothing to move.
        if (oldKey === seriesKey || currentSeriesKeys.has(oldKey)) continue;
        moves.set(oldKey, {
          showKey: seriesKey,
          episodeKey: episodeItemKey(seriesKey, episode.externalId),
        });
      }
    }
  }
  return moves;
}

/** Must run inside a rw transaction over `history` and `favorites`. */
export async function regroupUserData(
  db: SimpleIptvDb,
  sourceId: string,
  details: readonly SeriesDetails[],
  currentSeriesKeys: ReadonlySet<string>,
): Promise<RegroupResult> {
  const moves = movesOf(sourceId, details, currentSeriesKeys);
  if (moves.size === 0) return { history: 0, favorites: 0 };

  // --- History ---
  const history = await db.history.where('[sourceId+type]').equals([sourceId, 'series']).toArray();
  const stored = new Map(history.map((h) => [h.itemKey, h]));
  const writes = new Map<string, HistoryEntry>();
  const deletes: string[] = [];
  const keepNewest = (candidate: HistoryEntry) => {
    const existing = writes.get(candidate.itemKey) ?? stored.get(candidate.itemKey);
    if (!existing || existing.lastWatchedAt < candidate.lastWatchedAt) {
      writes.set(candidate.itemKey, candidate);
    }
  };
  const movedEpisodes = new Set<string>();
  for (const h of history) {
    const marker = h.itemKey.indexOf(EPISODE_MARKER);
    if (marker < 0) continue;
    const move = moves.get(h.itemKey.slice(0, marker));
    if (!move) continue;
    keepNewest({ ...h, itemKey: move.episodeKey });
    deletes.push(h.itemKey);
    movedEpisodes.add(h.itemKey.slice(0, marker));
  }
  for (const h of history) {
    const move = moves.get(h.itemKey);
    if (!move) continue;
    // The old entry pointed at its own (old) episode key: dropped.
    const fields: HistoryEntry = { ...h };
    delete fields.episodeKey;
    if (!movedEpisodes.has(h.itemKey)) keepNewest({ ...fields, itemKey: move.episodeKey });
    keepNewest({ ...fields, itemKey: move.showKey, episodeKey: move.episodeKey });
    deletes.push(h.itemKey);
  }
  if (deletes.length > 0) {
    await db.history.bulkDelete(deletes);
    await db.history.bulkPut([...writes.values()]);
  }

  // --- Favourites ---
  const favorites = await db.favorites
    .where('[sourceId+type]')
    .equals([sourceId, 'series'])
    .toArray();
  const storedFavorites = new Map(favorites.map((f) => [f.itemKey, f]));
  const favoriteWrites = new Map<string, Favorite>();
  const favoriteDeletes: string[] = [];
  for (const f of favorites) {
    const move = moves.get(f.itemKey);
    if (!move) continue;
    const existing = favoriteWrites.get(move.showKey) ?? storedFavorites.get(move.showKey);
    if (!existing || f.addedAt < existing.addedAt) {
      favoriteWrites.set(move.showKey, { ...f, itemKey: move.showKey });
    }
    favoriteDeletes.push(f.itemKey);
  }
  if (favoriteDeletes.length > 0) {
    await db.favorites.bulkDelete(favoriteDeletes);
    await db.favorites.bulkPut([...favoriteWrites.values()]);
  }
  return { history: deletes.length, favorites: favoriteDeletes.length };
}
