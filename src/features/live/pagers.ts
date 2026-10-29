// Paged access to the channels of a Live category (LIV-01 AC2). The list never holds a whole
// 20 000-channel category in memory: it asks a pager for the rows around the viewport.
import { catalogRepo, favoritesRepo, historyRepo, isProtectedItem, type Channel } from '@/core/db';
import { LIVE_RECENT_LIMIT } from '@/ui/routes/live';
import type { LiveCategory } from './categories';

export interface ChannelPager {
  /** Number of channels in the category. */
  readonly total: number;
  /** Channels `[offset, offset + limit)` in display order. */
  load(offset: number, limit: number): Promise<Channel[]>;
  /** Position of `channel` in this category, or -1 (LIV-02: zapping after a reload). */
  locate(channel: Channel): Promise<number>;
  /**
   * Every row in display order, one source category at a time (LIV-04 filter index): a single
   * index walk per category instead of `offset` pages, which IndexedDB skips one by one.
   */
  scan?(onRows: (rows: readonly Channel[]) => void): Promise<void>;
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

/** Channels read by key per page of a keyed pager's `scan`. */
const SCAN_CHUNK = 2_000;

/**
 * Channels of known keys, in this order, read by key page by page (UX-07: the visible channels of
 * categories with protected ones hidden). Only the keys stay in memory.
 */
export function keyedPager(keys: readonly string[]): ChannelPager {
  const loadKeys = async (slice: readonly string[]) => {
    const rows = await catalogRepo.getMany('live', slice);
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return slice.flatMap((key) => byKey.get(key) ?? []);
  };
  return {
    total: keys.length,
    load: (offset, limit) => loadKeys(keys.slice(offset, offset + limit)),
    locate: (channel) => Promise.resolve(keys.indexOf(channel.key)),
    async scan(onRows) {
      for (let at = 0; at < keys.length; at += SCAN_CHUNK) {
        onRows(await loadKeys(keys.slice(at, at + SCAN_CHUNK)));
      }
    },
  };
}

/**
 * Keys of the channels that are not protected (UX-07) of the given categories, in display order,
 * memoised for one (source, sync, categories) at a time. One index walk per category (as the
 * LIV-04 filter index does); only the keys are kept.
 */
let visibleKeys: { key: string; keys: Promise<string[]> } | undefined;

/** Forgets the memoised visible keys (tests; a sync already invalidates them via `lastSyncAt`). */
export function clearVisibleKeysCache(): void {
  visibleKeys = undefined;
}

function unprotectedKeys(
  sourceId: string,
  syncStamp: number | undefined,
  categoryKeys: readonly string[],
): Promise<string[]> {
  const key = [sourceId, syncStamp ?? 'never', ...categoryKeys].join('\n');
  if (visibleKeys?.key !== key) {
    const keys = (async () => {
      const out: string[] = [];
      for (const catKey of categoryKeys) {
        for (const channel of await catalogRepo.listByCategory('live', catKey)) {
          if (!isProtectedItem(channel)) out.push(channel.key);
        }
      }
      return out;
    })();
    visibleKeys = { key, keys };
    keys.catch(() => {
      if (visibleKeys?.keys === keys) visibleKeys = undefined;
    });
  }
  return visibleKeys.keys;
}

export interface PagerOptions {
  /**
   * Settings › Playback "Hide protected content" (UX-07): DRM/DASH channels are left out, and the
   * pager's total counts only the others. Source categories are then read once to collect the
   * visible keys (see `unprotectedKeys`) instead of being paged through their index.
   */
  hideProtected?: boolean;
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
  { hideProtected = false }: PagerOptions = {},
): Promise<ChannelPager> {
  const visible = (channels: readonly Channel[]) =>
    hideProtected ? channels.filter((c) => !isProtectedItem(c)) : channels;
  switch (category.kind) {
    case 'source':
      if (hideProtected) {
        return keyedPager(await unprotectedKeys(sourceId, syncStamp, [category.key]));
      }
      return categoryPager(category.key, await catalogRepo.countByCategory('live', category.key));
    case 'all': {
      if (hideProtected) {
        return keyedPager(await unprotectedKeys(sourceId, syncStamp, sourceCategoryKeys));
      }
      const counts = await countsForAll(sourceId, syncStamp, sourceCategoryKeys);
      return concatPager(sourceCategoryKeys.map((key, i) => ({ key, count: counts[i] ?? 0 })));
    }
    case 'favorites': {
      const favorites = await favoritesRepo.list(sourceId, 'live');
      return memoryPager(
        visible(
          await catalogRepo.getMany(
            'live',
            favorites.map((f) => f.itemKey),
          ),
        ),
      );
    }
    case 'recent': {
      // Same rule and limit as Home "Recent channels": the most recent channels still in the list.
      const { items } = await historyRepo.listRecentItems(sourceId, ['live'], {
        limit: LIVE_RECENT_LIMIT,
      });
      return memoryPager(visible(items.map(({ item }) => item)));
    }
  }
}
