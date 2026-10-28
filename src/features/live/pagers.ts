// Paged access to the channels of a Live category (LIV-01 AC2). The list never holds a whole
// 20 000-channel category in memory: it asks a pager for the rows around the viewport.
import { catalogRepo, favoritesRepo, historyRepo, type Channel } from '@/core/db';
import type { LiveCategory } from './categories';

export interface ChannelPager {
  /** Number of channels in the category. */
  readonly total: number;
  /** Channels `[offset, offset + limit)` in display order. */
  load(offset: number, limit: number): Promise<Channel[]>;
}

/** How many recently watched channels "Recent" shows. */
export const RECENT_LIMIT = 50;

/** A small list already in memory (favorites, recent). */
function memoryPager(channels: readonly Channel[]): ChannelPager {
  return {
    total: channels.length,
    load: (offset, limit) => Promise.resolve(channels.slice(offset, offset + limit)),
  };
}

/** One source category, read page by page through the `[categoryKey+order]` index. */
function categoryPager(key: string, total: number): ChannelPager {
  return {
    total,
    load: (offset, limit) => catalogRepo.listByCategory('live', key, { offset, limit }),
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
  };
}

/** Builds the pager of a category of the given source. */
export async function createPager(
  category: LiveCategory,
  sourceId: string,
  sourceCategoryKeys: readonly string[],
): Promise<ChannelPager> {
  switch (category.kind) {
    case 'source':
      return categoryPager(category.key, await catalogRepo.countByCategory('live', category.key));
    case 'all': {
      const counts = await Promise.all(
        sourceCategoryKeys.map((key) => catalogRepo.countByCategory('live', key)),
      );
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
