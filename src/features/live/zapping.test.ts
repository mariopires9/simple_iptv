import { describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/core/db';
import { PageCache } from './pageCache';
import type { ChannelPager } from './pagers';
import { locate, neighbour } from './zapping';

const channel = (i: number) => ({ key: `s:live:${i}`, name: `Channel ${i}`, order: i }) as Channel;

function pager(total: number) {
  const load = vi.fn((offset: number, limit: number) =>
    Promise.resolve(
      Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) =>
        channel(offset + i),
      ),
    ),
  );
  const locateFn = vi.fn((c: Channel) => Promise.resolve(c.order < total ? c.order : -1));
  const p: ChannelPager = { total, load, locate: locateFn };
  return { p, load, locate: locateFn };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('zapping', () => {
  it('steps from the known index, reading an uncached neighbour through the pager', async () => {
    const { p, load, locate: loc } = pager(300);
    const cache = new PageCache(p, 100, 3);
    cache.subscribe(() => {});
    cache.setViewport(0, 99);
    await flush();
    load.mockClear();
    // Row 99 is the last of page 0: the next one is on page 1, not cached.
    expect(await neighbour(cache, { channel: channel(99), index: 99 }, 1)).toEqual({
      channel: channel(100),
      index: 100,
    });
    expect(load).toHaveBeenCalledWith(100, 1);
    expect(loc).not.toHaveBeenCalled();
  });

  it('wraps around both ends', async () => {
    const { p } = pager(3);
    const cache = new PageCache(p);
    expect((await neighbour(cache, { channel: channel(2), index: 2 }, 1))?.index).toBe(0);
    expect((await neighbour(cache, { channel: channel(0), index: 0 }, -1))?.index).toBe(2);
  });

  it('locates an unknown index in the cached pages first, then through the pager', async () => {
    const { p, locate: loc } = pager(300);
    const cache = new PageCache(p, 100, 3);
    cache.subscribe(() => {});
    cache.setViewport(0, 0);
    await flush();
    expect(await locate(cache, { channel: channel(42) })).toBe(42);
    expect(loc).not.toHaveBeenCalled();
    expect(await locate(cache, { channel: channel(250) })).toBe(250);
    expect(loc).toHaveBeenCalledTimes(1);
  });

  it('a channel outside the category zaps to its first (next) or last (previous) row', async () => {
    const { p } = pager(5);
    const cache = new PageCache(p);
    const outsider = channel(99);
    expect((await neighbour(cache, { channel: outsider }, 1))?.index).toBe(0);
    expect((await neighbour(cache, { channel: outsider }, -1))?.index).toBe(4);
    expect(await neighbour(new PageCache(pager(0).p), { channel: outsider }, 1)).toBeUndefined();
  });
});
