import { describe, expect, it, vi } from 'vitest';
import type { Movie } from '@/core/db';
import { MoviePageCache } from './pageCache';

const movie = (key: string): Movie => ({
  key,
  sourceId: 's',
  type: 'movie',
  externalId: key,
  name: key,
  order: 0,
  streamPath: '',
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const loader = () => vi.fn((ks: readonly string[]) => Promise.resolve(ks.map(movie)));
/** Pages (by first key) the loader was asked for. */
const pagesRead = (load: ReturnType<typeof loader>) => load.mock.calls.map(([ks]) => ks[0]);

describe('MoviePageCache', () => {
  const keys = Array.from({ length: 200 }, (_, i) => `k${i}`);

  it('reads only the pages covering the viewport, by key, and notifies', async () => {
    const load = loader();
    const cache = new MoviePageCache(keys, load, 10, 3);
    const onChange = vi.fn();
    cache.subscribe(onChange);
    cache.setViewport(12, 25);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(1, keys.slice(10, 20));
    await flush();
    expect(cache.get(12)?.key).toBe('k12');
    expect(cache.get(5)).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('never re-requests a page that is cached or in flight', async () => {
    const load = loader();
    const cache = new MoviePageCache(keys, load, 10, 3);
    cache.subscribe(() => {});
    cache.setViewport(0, 15);
    cache.setViewport(0, 15); // still in flight
    await flush();
    cache.setViewport(5, 19); // cached
    cache.pin(3);
    expect(pagesRead(load)).toEqual(['k0', 'k10']);
  });

  it('keeps at most maxPages pages, evicting the farthest from the viewport', async () => {
    const load = loader();
    const cache = new MoviePageCache(keys, load, 10, 2);
    cache.subscribe(() => {});
    cache.setViewport(0, 9);
    await flush();
    cache.setViewport(40, 49);
    await flush();
    cache.setViewport(30, 39);
    await flush();
    expect(cache.cachedPages).toBe(2);
    expect(cache.get(0)).toBeUndefined();
    expect(cache.get(45)?.key).toBe('k45');
  });

  it('the active cell’s page is pinned: read once and never evicted while scrolling far away', async () => {
    const load = loader();
    const cache = new MoviePageCache(keys, load, 10, 2);
    cache.subscribe(() => {});
    cache.pin(3);
    cache.setViewport(0, 9);
    await flush();
    for (let start = 20; start < 200; start += 10) {
      cache.setViewport(start, start + 9);
      cache.pin(3); // the grid re-pins on every render of the active cell
      await flush();
    }
    expect(pagesRead(load).filter((k) => k === 'k0')).toHaveLength(1);
    expect(cache.get(3)?.key).toBe('k3');
    // Pinned page + the viewport's page (maxPages 2).
    expect(cache.cachedPages).toBe(2);
    expect(cache.get(195)?.key).toBe('k195');
  });

  it('pinning does not move the eviction centre: the viewport alone decides', async () => {
    const load = loader();
    const cache = new MoviePageCache(keys, load, 10, 3);
    cache.subscribe(() => {});
    cache.setViewport(100, 119); // pages 10, 11
    await flush();
    cache.pin(195); // page 19, far from the viewport
    await flush();
    cache.pin(undefined);
    cache.setViewport(110, 119); // page 11 again (cached) — centre stays near 11
    cache.setViewport(120, 129); // page 12 → 4 pages: evict the farthest from the viewport
    await flush();
    expect(cache.get(195)).toBeUndefined();
    expect(cache.get(105)?.key).toBe('k105');
    expect(cache.get(125)?.key).toBe('k125');
  });

  it('a key missing from IndexedDB leaves a hole, not a shifted row', async () => {
    const load = vi.fn((ks: readonly string[]) =>
      Promise.resolve(ks.filter((k) => k !== 'k1').map(movie)),
    );
    const cache = new MoviePageCache(keys, load, 10, 2);
    cache.subscribe(() => {});
    cache.setViewport(0, 3);
    await flush();
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)?.key).toBe('k2');
  });

  it('reports a failed page and reads it again next time', async () => {
    const load = vi
      .fn<(ks: readonly string[]) => Promise<Movie[]>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation((ks) => Promise.resolve(ks.map(movie)));
    const cache = new MoviePageCache(keys, load, 10, 2);
    const onError = vi.fn();
    cache.subscribe(() => {}, onError);
    cache.setViewport(0, 0);
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    cache.setViewport(0, 0);
    await flush();
    expect(cache.get(0)?.key).toBe('k0');
  });
});
