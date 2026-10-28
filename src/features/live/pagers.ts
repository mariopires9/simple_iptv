// Paged access to the channels of a Live category (LIV-01 AC2). The list never holds a whole
// 20 000-channel category in memory: it asks a pager for the rows around the viewport.
import { catalogRepo, favoritesRepo, historyRepo, type Channel } from '@/core/db';
import type { LiveCategory } from './categories';

export interface ChannelPager {
  /** Number of channels in the category. */
  readonly total: number;
  /** Channels `[offset, offset + limit)` in display order. */
  load(offset: number, limit: number): Promise<Channel[]>;
  /** Position of `channel` in this category, or -1 (LIV-02: zapping after a reload). */
  locate(channel: Channel): Promise<number>;
}

/**
 * Binary search of `channel` among `count` rows sorted by `order` (one category, read through
 * its `[categoryKey+order]` index): ~log2(count) single-row reads instead of a scan.
 */
async function bisect(
  count: number,
  at: (index: number) => Promise<Channel | undefined>,
  channel: Channel,
): Promise<number> {
  let lo = 0;
  let hi = count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const row = await at(mid);
    if (!row) return -1;
    if (row.key === channel.key) return mid;
    if (row.order < channel.order) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

const rowOf = (catKey: string) => async (index: number) =>
  (await catalogRepo.listByCategory('live', catKey, { offset: index, limit: 1 }))[0];

/** How many recently watched channels "Recent" shows. */
export const RECENT_LIMIT = 50;

/** A small list already in memory (favorites, recent). */
function memoryPager(channels: readonly Channel[]): ChannelPager {
  return {
    total: channels.length,
    load: (offset, limit) => Promise.resolve(channels.slice(offset, offset + limit)),
    locate: (channel) => Promise.resolve(channels.findIndex((c) => c.key === channel.key)),
  };
}

/** One source category, read page by page through the `[categoryKey+order]` index. */
function categoryPager(key: string, total: number): ChannelPager {
  return {
    total,
    load: (offset, limit) => catalogRepo.listByCategory('live', key, { offset, limit }),
    locate: (channel) =>
      channel.categoryKey === key ? bisect(total, rowOf(key), channel) : Promise.resolve(-1),
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
      const segment = placed.find((s) => s.key === channel.categoryKey);
      if (!segment) return -1;
      const local = await bisect(segment.count, rowOf(segment.key), channel);
      return local < 0 ? -1 : segment.start + local;
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
 * Builds the pager of a category of the given source. `syncStamp` (the source's `lastSyncAt`)
 * versions the memoised counts of "All".
 */
export async function createPager(
  category: LiveCategory,
  sourceId: string,
  sourceCategoryKeys: readonly string[],
  syncStamp?: number,
): Promise<ChannelPager> {
  switch (category.kind) {
    case 'source':
      return categoryPager(category.key, await catalogRepo.countByCategory('live', category.key));
    case 'all': {
      const counts = await countsForAll(sourceId, syncStamp, sourceCategoryKeys);
      return concatPager(sourceCategoryKeys.map((key, i) => ({ key, count: counts[i] ?? 0 })));
    }
    case 'favorites': {
      const favorites = await favoritesRepo.list(sourceId, 'live');
      return memoryPager(
        await catalogRepo.getMany(
          'live',
          favorites.map((f) => f.itemKey),
        ),
      );
    }
    case 'recent': {
      const recent = await historyRepo.listRecent(sourceId, 'live', RECENT_LIMIT);
      return memoryPager(
        await catalogRepo.getMany(
          'live',
          recent.map((h) => h.itemKey),
        ),
      );
    }
  }
}
