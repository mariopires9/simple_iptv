import { describe, expect, it, vi } from 'vitest';
import { CatalogPageCache, keyedPageSource, type PageSource } from './pageCache';

interface Row {
  key: string;
  name: string;
}

const row = (i: number): Row => ({ key: `k${i}`, name: `Row ${i}` });

/** A positional source of `total` rows; `load` records `[offset, limit]`. */
function fakeSource(total: number) {
  const load = vi.fn((offset: number, limit: number) =>
    Promise.resolve(
      Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) =>
        row(offset + i),
      ),
    ),
  );
  const source: PageSource<Row> = { total, load };
  return { source, load };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Offsets of the pages a source was asked for. */
const offsets = (load: ReturnType<typeof fakeSource>['load']) =>
  load.mock.calls.map(([offset]) => offset);

describe('CatalogPageCache', () => {
  it('loads the pages covering the viewport once, then serves rows from memory', async () => {
    const { source, load } = fakeSource(1000);
    const cache = new CatalogPageCache(source, 100, 4);
    const onChange = vi.fn();
    cache.subscribe(onChange);
    cache.setViewport(150, 250);
    cache.setViewport(150, 250); // in flight: not requested again
    expect(load.mock.calls).toEqual([
      [100, 100],
      [200, 100],
    ]);
    expect(cache.get(150)).toBeUndefined();
    await flush();
    expect(cache.get(150)?.name).toBe('Row 150');
    expect(cache.get(299)?.name).toBe('Row 299');
    expect(onChange).toHaveBeenCalledTimes(2);
    cache.setViewport(120, 280); // cached
    cache.pin(130); // cached
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps at most maxPages pages, evicting the farthest from the viewport', async () => {
    const { source } = fakeSource(10_000);
    const cache = new CatalogPageCache(source, 100, 3);
    cache.subscribe(() => {});
    for (const page of [0, 1, 2, 3, 50]) {
      cache.setViewport(page * 100, page * 100);
      await flush();
    }
    expect(cache.cachedPages).toBe(3);
    expect(cache.get(5000)).toBeDefined();
    expect(cache.get(0)).toBeUndefined();
  });

  it('never evicts the pinned page of the active row, so it is read only once', async () => {
    // Active row 0, then the viewport scrolls 2 000 rows away (and further) page by page,
    // exactly as Live's ChannelList calls it: the active row first, then the viewport.
    const { source, load } = fakeSource(10_000);
    const cache = new CatalogPageCache(source, 100, 3);
    cache.subscribe(() => {});
    for (let r = 0; r <= 2_000; r += 100) {
      cache.pin(0);
      cache.setViewport(0, 0);
      cache.setViewport(r, r + 50);
      await flush();
    }
    expect(offsets(load).filter((offset) => offset === 0)).toHaveLength(1);
    expect(cache.get(0)?.name).toBe('Row 0');
    expect(cache.get(2_000)?.name).toBe('Row 2000');
    expect(cache.cachedPages).toBe(3);

    // Unpinned, it is evicted like any other page.
    cache.pin(undefined);
    cache.setViewport(5_000, 5_000);
    await flush();
    expect(cache.get(0)).toBeUndefined();
  });

  it('loads a pinned page by itself (the grid’s active cell) and keeps it while scrolling', async () => {
    const { source, load } = fakeSource(200);
    const cache = new CatalogPageCache(source, 10, 2);
    cache.subscribe(() => {});
    cache.pin(3);
    expect(offsets(load)).toEqual([0]);
    cache.setViewport(0, 9);
    await flush();
    for (let start = 20; start < 200; start += 10) {
      cache.setViewport(start, start + 9);
      cache.pin(3); // the grid re-pins on every render of the active cell
      await flush();
    }
    expect(offsets(load).filter((offset) => offset === 0)).toHaveLength(1);
    expect(cache.get(3)?.key).toBe('k3');
    // Pinned page + the viewport's page (maxPages 2).
    expect(cache.cachedPages).toBe(2);
    expect(cache.get(195)?.key).toBe('k195');
  });

  it('pinning does not move the eviction centre: the viewport alone decides', async () => {
    const { source } = fakeSource(200);
    const cache = new CatalogPageCache(source, 10, 3);
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

  it('ignores a pin out of range (and unpins that owner)', async () => {
    const { source, load } = fakeSource(50);
    const cache = new CatalogPageCache(source, 10, 1);
    cache.subscribe(() => {});
    cache.pin(5);
    await flush();
    cache.pin(50);
    cache.pin(-1);
    expect(load).toHaveBeenCalledTimes(1);
    cache.setViewport(40, 49);
    await flush();
    expect(cache.get(5)).toBeUndefined();
  });

  it('serves several lists: each is notified, each pin is kept, results stop with the last', async () => {
    const { source, load } = fakeSource(10_000);
    const cache = new CatalogPageCache(source, 100, 2);
    const main = vi.fn();
    const panel = vi.fn();
    const offMain = cache.subscribe(main);
    const offPanel = cache.subscribe(panel);
    const mainOwner = {};
    const panelOwner = {};
    cache.pin(0, mainOwner);
    cache.pin(5_000, panelOwner);
    cache.setViewport(0, 0);
    cache.setViewport(5_000, 5_000);
    await flush();
    expect(main).toHaveBeenCalledTimes(2);
    expect(panel).toHaveBeenCalledTimes(2);
    // Two more pages: both pinned pages survive eviction (maxPages is a soft limit for pins).
    for (const r of [2_000, 3_000]) {
      cache.setViewport(r, r);
      await flush();
    }
    expect(cache.get(0)).toBeDefined();
    expect(cache.get(5_000)).toBeDefined();
    expect(offsets(load).filter((offset) => offset === 0)).toHaveLength(1);

    // One list leaves: the other still gets pages.
    offPanel();
    cache.pin(undefined, panelOwner);
    cache.setViewport(7_000, 7_000);
    await flush();
    expect(cache.get(7_000)).toBeDefined();
    expect(cache.get(5_000)).toBeUndefined();
    offMain();
    cache.setViewport(9_000, 9_000);
    await flush();
    expect(cache.get(9_000)).toBeUndefined();
  });

  it('indexOf finds a row among the cached pages only', async () => {
    const { source } = fakeSource(1000);
    const cache = new CatalogPageCache(source, 100, 4);
    cache.subscribe(() => {});
    expect(cache.indexOf('k250')).toBe(-1);
    cache.setViewport(250, 250);
    await flush();
    expect(cache.indexOf('k250')).toBe(250);
    expect(cache.indexOf('k999')).toBe(-1);
  });

  it('clamps to the total and ignores an empty source', () => {
    const { source, load } = fakeSource(150);
    const cache = new CatalogPageCache(source, 100, 3);
    cache.setViewport(0, 10_000);
    expect(load.mock.calls).toEqual([
      [0, 100],
      [100, 100],
    ]);
    const empty = fakeSource(0);
    new CatalogPageCache(empty.source, 100, 3).setViewport(0, 10);
    expect(empty.load).not.toHaveBeenCalled();
  });

  it('drops results that arrive after unsubscribe', async () => {
    const { source } = fakeSource(500);
    const cache = new CatalogPageCache(source, 100, 3);
    const onChange = vi.fn();
    const unsubscribe = cache.subscribe(onChange);
    cache.setViewport(0, 0);
    unsubscribe();
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(cache.get(0)).toBeUndefined();
  });

  it('reports a failed page and reads it again next time', async () => {
    const load = vi
      .fn<PageSource<Row>['load']>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation((offset, limit) =>
        Promise.resolve(Array.from({ length: limit }, (_, i) => row(offset + i))),
      );
    const cache = new CatalogPageCache({ total: 10, load }, 10, 2);
    const onError = vi.fn();
    cache.subscribe(() => {}, onError);
    cache.setViewport(0, 5);
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    cache.setViewport(0, 5);
    await flush();
    expect(cache.get(0)?.key).toBe('k0');
  });
});

describe('keyedPageSource', () => {
  const keys = Array.from({ length: 25 }, (_, i) => `k${i}`);

  it('reads a page by its keys and leaves a hole for a missing key, not a shifted row', async () => {
    const loadByKeys = vi.fn((ks: readonly string[]) =>
      Promise.resolve(ks.filter((k) => k !== 'k1').map((k) => ({ key: k, name: k }))),
    );
    const source = keyedPageSource(keys, loadByKeys);
    expect(source.total).toBe(25);
    const rows = await source.load(0, 10);
    expect(loadByKeys).toHaveBeenCalledWith(keys.slice(0, 10));
    expect(rows).toHaveLength(10);
    expect(rows[1]).toBeUndefined();
    expect(rows[2]?.key).toBe('k2');

    await source.load(20, 10);
    expect(loadByKeys).toHaveBeenLastCalledWith(keys.slice(20));
  });

  it('places rows by key even when the reader returns them out of order', async () => {
    const source = keyedPageSource(['a', 'b', 'c'], () =>
      Promise.resolve([{ key: 'c' }, { key: 'a' }, { key: 'b' }]),
    );
    expect((await source.load(0, 3)).map((r) => r?.key)).toEqual(['a', 'b', 'c']);
  });
});
