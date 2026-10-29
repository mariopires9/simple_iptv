// The movie grid's cache. The paging, eviction and pinning are tested with the shared cache
// (`src/ui/catalog/pageCache.test.ts`); this covers the Movies wiring: rows read by key.
import { describe, expect, it, vi } from 'vitest';
import type { Movie } from '@/core/db';
import { MAX_PAGES, MoviePageCache, PAGE_SIZE } from './pageCache';

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

describe('MoviePageCache', () => {
  const keys = Array.from({ length: 200 }, (_, i) => `k${i}`);

  it('reads only the pages covering the viewport, by key, and notifies', async () => {
    const load = loader();
    const cache = new MoviePageCache(keys, load, 10, 3);
    const onChange = vi.fn();
    cache.subscribe(onChange);
    expect(cache.total).toBe(200);
    cache.setViewport(12, 25);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(1, keys.slice(10, 20));
    await flush();
    expect(cache.get(12)?.key).toBe('k12');
    expect(cache.get(5)).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(2);
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

  it('pages PAGE_SIZE keys at a time and keeps at most MAX_PAGES pages by default', async () => {
    const many = Array.from({ length: PAGE_SIZE * (MAX_PAGES + 1) }, (_, i) => `m${i}`);
    const load = loader();
    const cache = new MoviePageCache(many, load);
    cache.subscribe(() => {});
    for (let page = 0; page <= MAX_PAGES; page++) {
      cache.setViewport(page * PAGE_SIZE, page * PAGE_SIZE);
      await flush();
    }
    expect(load.mock.calls[0]?.[0]).toHaveLength(PAGE_SIZE);
    expect(cache.cachedPages).toBe(MAX_PAGES);
  });
});
