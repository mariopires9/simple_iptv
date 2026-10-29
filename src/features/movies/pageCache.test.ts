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

describe('MoviePageCache', () => {
  const keys = Array.from({ length: 50 }, (_, i) => `k${i}`);

  it('reads only the pages covering the requested range, by key, and notifies', async () => {
    const load = vi.fn((ks: readonly string[]) => Promise.resolve(ks.map(movie)));
    const cache = new MoviePageCache(keys, load, 10, 3);
    const onChange = vi.fn();
    cache.subscribe(onChange);
    cache.ensure(12, 25);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(1, keys.slice(10, 20));
    await flush();
    expect(cache.get(12)?.key).toBe('k12');
    expect(cache.get(5)).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(2);
    // Already cached: no new reads.
    cache.ensure(10, 29);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps at most maxPages pages, evicting the farthest', async () => {
    const load = vi.fn((ks: readonly string[]) => Promise.resolve(ks.map(movie)));
    const cache = new MoviePageCache(keys, load, 10, 2);
    cache.subscribe(() => {});
    cache.ensure(0, 9);
    await flush();
    cache.ensure(40, 49);
    await flush();
    cache.ensure(30, 39);
    await flush();
    expect(cache.cachedPages).toBe(2);
    expect(cache.get(0)).toBeUndefined();
    expect(cache.get(45)?.key).toBe('k45');
  });

  it('a key missing from IndexedDB leaves a hole, not a shifted row', async () => {
    const load = vi.fn((ks: readonly string[]) =>
      Promise.resolve(ks.filter((k) => k !== 'k1').map(movie)),
    );
    const cache = new MoviePageCache(keys, load, 10, 2);
    cache.subscribe(() => {});
    cache.ensure(0, 3);
    await flush();
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)?.key).toBe('k2');
  });

  it('reports a failed page and reads it again on the next ensure', async () => {
    const load = vi
      .fn<(ks: readonly string[]) => Promise<Movie[]>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation((ks) => Promise.resolve(ks.map(movie)));
    const cache = new MoviePageCache(keys, load, 10, 2);
    const onError = vi.fn();
    cache.subscribe(() => {}, onError);
    cache.ensure(0, 0);
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    cache.ensure(0, 0);
    await flush();
    expect(cache.get(0)?.key).toBe('k0');
  });
});
