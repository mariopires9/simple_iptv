import { describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/core/db';
import { PageCache } from './pageCache';
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
  const pager: ChannelPager = { total, load };
  return { pager, load };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PageCache', () => {
  it('loads the pages covering a range once, then serves rows from memory', async () => {
    const { pager, load } = fakePager(1000);
    const cache = new PageCache(pager, 100, 4);
    const onChange = vi.fn();
    cache.subscribe(onChange);
    cache.ensure(150, 250);
    cache.ensure(150, 250); // pending: not requested again
    expect(load.mock.calls).toEqual([
      [100, 100],
      [200, 100],
    ]);
    expect(cache.get(150)).toBeUndefined();
    await flush();
    expect(cache.get(150)?.name).toBe('Channel 150');
    expect(cache.get(299)?.name).toBe('Channel 299');
    expect(onChange).toHaveBeenCalledTimes(2);
    cache.ensure(120, 280);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps at most maxPages pages, evicting the farthest from the viewport', async () => {
    const { pager } = fakePager(10_000);
    const cache = new PageCache(pager, 100, 3);
    cache.subscribe(() => {});
    for (const page of [0, 1, 2, 3, 50]) {
      cache.ensure(page * 100, page * 100);
      await flush();
    }
    expect(cache.cachedPages).toBe(3);
    expect(cache.get(5000)).toBeDefined();
    expect(cache.get(0)).toBeUndefined();
  });

  it('clamps to the total and ignores an empty pager', () => {
    const { pager, load } = fakePager(150);
    const cache = new PageCache(pager, 100, 3);
    cache.ensure(0, 10_000);
    expect(load.mock.calls).toEqual([
      [0, 100],
      [100, 100],
    ]);
    const empty = fakePager(0);
    new PageCache(empty.pager).ensure(0, 10);
    expect(empty.load).not.toHaveBeenCalled();
  });

  it('drops results that arrive after unsubscribe, and reports load errors', async () => {
    const { pager } = fakePager(500);
    const cache = new PageCache(pager, 100, 3);
    const onChange = vi.fn();
    const unsubscribe = cache.subscribe(onChange);
    cache.ensure(0, 0);
    unsubscribe();
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(cache.get(0)).toBeUndefined();

    const failing = new PageCache({ total: 10, load: () => Promise.reject(new Error('boom')) });
    const onError = vi.fn();
    failing.subscribe(() => {}, onError);
    failing.ensure(0, 5);
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
  });
});
