// Live's channel cache. The paging, eviction, pins and subscribers are tested with the shared
// cache (`src/ui/catalog/pageCache.test.ts`); this covers the Live wiring.
import { describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/core/db';
import { MAX_PAGES, PAGE_SIZE, PageCache } from './pageCache';
import type { ChannelPager } from './pagers';

const channel = (i: number) => ({ key: `s:live:${i}`, name: `Channel ${i}` }) as Channel;

function fakePager(total: number) {
  const load = vi.fn((offset: number, limit: number) =>
    Promise.resolve(
      Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) =>
        channel(offset + i),
      ),
    ),
  );
  const pager: ChannelPager = { total, load, locate: () => Promise.resolve(-1) };
  return { pager, load };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PageCache (Live)', () => {
  it('pages the channels of its pager by offset, PAGE_SIZE at a time', async () => {
    const { pager, load } = fakePager(PAGE_SIZE * (MAX_PAGES + 2));
    const cache = new PageCache(pager);
    cache.subscribe(() => {});
    expect(cache.pager).toBe(pager);
    expect(cache.total).toBe(PAGE_SIZE * (MAX_PAGES + 2));
    cache.setViewport(PAGE_SIZE + 1, PAGE_SIZE + 1);
    expect(load.mock.calls).toEqual([[PAGE_SIZE, PAGE_SIZE]]);
    await flush();
    expect(cache.get(PAGE_SIZE + 1)?.name).toBe(`Channel ${PAGE_SIZE + 1}`);
    expect(cache.indexOf(`s:live:${PAGE_SIZE + 1}`)).toBe(PAGE_SIZE + 1);
  });

  it('keeps at most MAX_PAGES pages by default', async () => {
    const { pager } = fakePager(PAGE_SIZE * (MAX_PAGES + 2));
    const cache = new PageCache(pager);
    cache.subscribe(() => {});
    for (let page = 0; page < MAX_PAGES + 2; page++) {
      cache.setViewport(page * PAGE_SIZE, page * PAGE_SIZE);
      await flush();
    }
    expect(cache.cachedPages).toBe(MAX_PAGES);
  });

  it('builds the quick-filter index once, and again after a failed build', async () => {
    const { pager, load } = fakePager(3);
    load.mockRejectedValueOnce(new Error('boom'));
    const cache = new PageCache(pager);
    await expect(cache.filterIndex()).rejects.toThrow('boom');
    await flush();
    const retry = cache.filterIndex();
    expect(cache.filterIndex()).toBe(retry);
    await expect(retry).resolves.toBeDefined();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
