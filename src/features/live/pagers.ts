// Paged access to the channels of a Live category (LIV-01 AC2). The list never holds a whole
// 20 000-channel category in memory: it asks a pager for the rows around the viewport.
import { catalogRepo, favoritesRepo, historyRepo, isProtectedItem, type Channel } from '@/core/db';
import { LIVE_RECENT_LIMIT } from '@/ui/routes/live';
import type { LiveCategory } from './categories';

export interface ChannelPager {
  /** Number of channels in the category. */
  readonly total: number;
  /**
   * Channels `[offset, offset + limit)` in display order. A hole (`undefined`) is a row that is
   * gone since the pager was built: it keeps its position (the rows after it are not shifted).
   */
  load(offset: number, limit: number): Promise<readonly (Channel | undefined)[]>;
  /** Position of `channel` in this category, or -1 (LIV-02: zapping after a reload). */
  locate(channel: Channel): Promise<number>;
  /**
   * Every row in display order, one source category at a time (LIV-04 filter index): a single
   * index walk per category instead of `offset` pages, which IndexedDB skips one by one.
   */
  scan?(onRows: (rows: readonly Channel[]) => void): Promise<void>;
  /** Protected channels "Hide protected content" left out of this category (UX-07). */
  readonly hidden?: number;
}

/**
 * Position of `channel` in the category `catKey`: one count over the `[categoryKey+order]`
 * index, then a one-row read to check it really is that channel (-1 otherwise, e.g. after a sync).
 */
async function indexIn(catKey: string, channel: Channel): Promise<number> {
  if (channel.categoryKey !== catKey) return -1;
  const index = await catalogRepo.indexInCategory('live', catKey, channel.order);
  const [row] = await catalogRepo.listByCategory('live', catKey, { offset: index, limit: 1 });
  return row?.key === channel.key ? index : -1;
}

/** A small list already in memory (favorites, recent). */
function memoryPager(channels: readonly Channel[]): ChannelPager {
  return {
    total: channels.length,
    load: (offset, limit) => Promise.resolve(channels.slice(offset, offset + limit)),
    locate: (channel) => Promise.resolve(channels.findIndex((c) => c.key === channel.key)),
    scan: (onRows) => {
      onRows(channels);
      return Promise.resolve();
    },
  };
}

/** One source category, read page by page through the `[categoryKey+order]` index. */
function categoryPager(key: string, total: number): ChannelPager {
  return {
    total,
    load: (offset, limit) => catalogRepo.listByCategory('live', key, { offset, limit }),
    locate: (channel) => indexIn(key, channel),
    scan: async (onRows) => onRows(await catalogRepo.listByCategory('live', key)),
  };
}

interface Segment {
  key: string;
  start: number;
  count: number;
}

/**
 * "All": the source categories one after another, in category order. A global offset is mapped
 * to (category, local offset) and each overlapping category is read through its index, so only
 * the requested rows leave IndexedDB.
 *
 * Known gap: core/db has no ordered index over all channels of a source, so channels without a
 * category are not reachable here (providers always assign one — see the LIV-01 report).
 */
export function concatPager(segments: readonly { key: string; count: number }[]): ChannelPager {
  const placed: Segment[] = [];
  let total = 0;
  for (const { key, count } of segments) {
    if (count <= 0) continue;
    placed.push({ key, start: total, count });
    total += count;
  }
  return {
    total,
    async load(offset, limit) {
      const end = Math.min(offset + limit, total);
      const reads: Promise<Channel[]>[] = [];
      for (const s of placed) {
        const from = Math.max(offset, s.start);
        const to = Math.min(end, s.start + s.count);
        if (from >= to) continue;
        reads.push(
          catalogRepo.listByCategory('live', s.key, { offset: from - s.start, limit: to - from }),
        );
      }
      return (await Promise.all(reads)).flat();
    },
    async locate(channel) {
      // `start` is the sum of the preceding categories' (memoised) counts.
      const segment = placed.find((s) => s.key === channel.categoryKey);
      if (!segment) return -1;
      const local = await indexIn(segment.key, channel);
      return local < 0 ? -1 : segment.start + local;
    },
    async scan(onRows) {
      for (const s of placed) onRows(await catalogRepo.listByCategory('live', s.key));
    },
  };
}

/**
 * Per-category channel counts of "All", memoised for one (source, sync) at a time: switching to
 * "All" would otherwise issue one count per source category every time. The catalogue only
 * changes on a sync, which moves `lastSyncAt`, so that timestamp is part of the key.
 */
let allCounts: { key: string; counts: Promise<number[]> } | undefined;

/** Forgets the memoised "All" counts (tests; a sync already invalidates them via `lastSyncAt`). */
export function clearCountCache(): void {
  allCounts = undefined;
}

function countsForAll(
  sourceId: string,
  syncStamp: number | undefined,
  keys: readonly string[],
): Promise<number[]> {
  const key = [sourceId, syncStamp ?? 'never', ...keys].join('\n');
  if (allCounts?.key !== key) {
    const counts = Promise.all(keys.map((k) => catalogRepo.countByCategory('live', k)));
    allCounts = { key, counts };
    // A failed count is not memoised: the next attempt (Retry) counts again.
    counts.catch(() => {
      if (allCounts?.counts === counts) allCounts = undefined;
    });
  }
  return allCounts.counts;
}

/**
 * Channels of known keys, in this order, read by key page by page (UX-07: the playable channels
 * of categories with protected ones hidden). Only the keys stay in memory. A row deleted since
 * the keys were collected leaves a hole (`undefined`) at its own position: pages are never short,
 * so the rows after it keep their places (the list shows a placeholder there).
 *
 * `scan` (LIV-04 filter index) walks `categoryKeys` through their index again, leaving protected
 * rows out, instead of reading every row by key.
 */
export function keyedPager(keys: readonly string[], categoryKeys: readonly string[]): ChannelPager {
  return {
    total: keys.length,
    async load(offset, limit) {
      const slice = keys.slice(offset, offset + limit);
      const rows = await catalogRepo.getMany('live', slice);
      const byKey = new Map(rows.map((row) => [row.key, row]));
      return slice.map((key) => byKey.get(key));
    },
    locate: (channel) => Promise.resolve(keys.indexOf(channel.key)),
    async scan(onRows) {
      for (const catKey of categoryKeys) {
        onRows((await catalogRepo.listByCategory('live', catKey)).filter(playable));
      }
    },
  };
}

const playable = (channel: Channel) => !isProtectedItem(channel);

/** The playable channels' keys of some categories, and how many protected ones were left out. */
interface VisibleKeys {
  keys: string[];
  hidden: number;
}

/**
 * Visible key lists kept in memory (one per category recently shown with the setting on, LRU).
 * Each holds only keys, at most one string per channel of its categories.
 */
export const MAX_VISIBLE_KEY_SETS = 4;
const visibleKeySets = new Map<string, Promise<VisibleKeys>>();

/** Forgets the memoised visible keys (tests; a sync already invalidates them via `lastSyncAt`). */
export function clearVisibleKeysCache(): void {
  visibleKeySets.clear();
}

/**
 * Keys of the playable channels (UX-07) of the given categories, in display order, memoised per
 * (source, sync, categories). One index walk per category, as the LIV-04 filter index does.
 */
function unprotectedKeys(
  sourceId: string,
  syncStamp: number | undefined,
  categoryKeys: readonly string[],
): Promise<VisibleKeys> {
  const id = [sourceId, syncStamp ?? 'never', ...categoryKeys].join('\n');
  let found = visibleKeySets.get(id);
  if (found) {
    // Most recently used last.
    visibleKeySets.delete(id);
    visibleKeySets.set(id, found);
    return found;
  }
  const reading = (async () => {
    const out: VisibleKeys = { keys: [], hidden: 0 };
    for (const catKey of categoryKeys) {
      for (const channel of await catalogRepo.listByCategory('live', catKey)) {
        if (playable(channel)) out.keys.push(channel.key);
        else out.hidden++;
      }
    }
    return out;
  })();
  found = reading;
  visibleKeySets.set(id, found);
  // A failed read is not memoised: Retry reads again.
  reading.catch(() => {
    if (visibleKeySets.get(id) === reading) visibleKeySets.delete(id);
  });
  while (visibleKeySets.size > MAX_VISIBLE_KEY_SETS) {
    const oldest = visibleKeySets.keys().next().value;
    if (oldest === undefined) break;
    visibleKeySets.delete(oldest);
  }
  return found;
}

export interface PagerOptions {
  /**
   * Settings › Playback "Hide protected content" (UX-07), for a source that has protected
   * channels: DRM/DASH channels are left out, and the pager's total counts only the others.
   * Source categories are then read once to collect the playable keys (`unprotectedKeys`)
   * instead of being paged through their index. The caller passes `false` when the source has
   * none (`Source.protectedCounts`), so nothing is walked.
   */
  hideProtected?: boolean;
  /**
   * Parental control (SEC-03): category keys whose channels are left out of "Favorites" and
   * "Recent" while locked. ("All" gets `sourceCategoryKeys` without them; a locked source category
   * is never paged.)
   */
  lockedCategories?: ReadonlySet<string>;
}

/** A pager, and how many protected channels the setting left out of it (UX-07 empty state). */
function withHidden(pager: ChannelPager, hidden: number): ChannelPager {
  return hidden > 0 ? { ...pager, hidden } : pager;
}

/**
 * Builds the pager of a category of the given source. `syncStamp` (the source's `lastSyncAt`)
 * versions the memoised counts of "All".
 */
export async function createPager(
  category: LiveCategory,
  sourceId: string,
  sourceCategoryKeys: readonly string[],
  syncStamp?: number,
  { hideProtected = false, lockedCategories }: PagerOptions = {},
): Promise<ChannelPager> {
  const inMemory = (all: readonly Channel[]) => {
    const channels =
      lockedCategories && lockedCategories.size > 0
        ? all.filter((c) => c.categoryKey === undefined || !lockedCategories.has(c.categoryKey))
        : all;
    if (!hideProtected) return memoryPager(channels);
    const shown = channels.filter(playable);
    return withHidden(memoryPager(shown), channels.length - shown.length);
  };
  switch (category.kind) {
    case 'source':
      if (hideProtected) {
        const { keys, hidden } = await unprotectedKeys(sourceId, syncStamp, [category.key]);
        return withHidden(keyedPager(keys, [category.key]), hidden);
      }
      return categoryPager(category.key, await catalogRepo.countByCategory('live', category.key));
    case 'all': {
      if (hideProtected) {
        const { keys, hidden } = await unprotectedKeys(sourceId, syncStamp, sourceCategoryKeys);
        return withHidden(keyedPager(keys, sourceCategoryKeys), hidden);
      }
      const counts = await countsForAll(sourceId, syncStamp, sourceCategoryKeys);
      return concatPager(sourceCategoryKeys.map((key, i) => ({ key, count: counts[i] ?? 0 })));
    }
    case 'favorites': {
      const favorites = await favoritesRepo.list(sourceId, 'live');
      return inMemory(
        await catalogRepo.getMany(
          'live',
          favorites.map((f) => f.itemKey),
        ),
      );
    }
    case 'recent': {
      // Same rule and limit as Home "Recent channels": the most recent channels still in the list.
      const { items } = await historyRepo.listRecentItems(sourceId, ['live'], {
        limit: LIVE_RECENT_LIMIT,
      });
      return inMemory(items.map(({ item }) => item));
    }
  }
}
