// SER-02 AC1: `get_series_info` cached in `seriesDetails` for 24 h, per source identity; failures
// and aborted answers are not cached; M3U details come from the entry.
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import { catalogRepo, itemKey, wipeAll, type Series, type Source } from '@/core/db';
import { NetError } from '@/core/net';
import { XTREAM_TEST_BASE_URL, XTREAM_TEST_CREDENTIALS, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { DETAILS_TTL_MS, loadSeriesDetails, localSeriesDetails } from './seriesDetails';

const requests: URL[] = [];
const server = createMswServer(...xtreamHandlers());
server.events.on('request:start', ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get('action') === 'get_series_info') requests.push(url);
});

const source: Source = {
  id: 'x9',
  kind: 'xtream',
  name: 'X',
  serverUrl: XTREAM_TEST_BASE_URL,
  username: XTREAM_TEST_CREDENTIALS.username,
  secretRef: 'xtream:x9',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncAt: 10,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};
const series = (externalId: string): Series => ({
  key: itemKey('x9', 'series', externalId),
  sourceId: 'x9',
  type: 'series',
  externalId,
  name: 'Example Drama',
  order: 0,
});

beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  await credentialVault.put('xtream:x9', XTREAM_TEST_CREDENTIALS.password);
});
afterEach(async () => {
  server.resetHandlers();
  requests.length = 0;
  await catalogRepo.putSeriesDetails({
    seriesKey: series('3001').key,
    sourceId: 'x9',
    fetchedAt: 0,
    seasons: [],
  });
});
afterAll(async () => {
  server.close();
  await wipeAll();
});

describe('loadSeriesDetails (Xtream)', () => {
  it('fetches once, then serves the cache for 24 h', async () => {
    let now = 1_000_000;
    const deps = { now: () => now };
    const first = await loadSeriesDetails(source, series('3001'), deps);
    expect(first.seasons.map((s) => s.number)).toEqual([1, 2]);
    expect(requests).toHaveLength(1);
    now += DETAILS_TTL_MS - 1;
    await loadSeriesDetails(source, series('3001'), deps);
    expect(requests).toHaveLength(1);
    now += 1;
    await loadSeriesDetails(source, series('3001'), deps);
    expect(requests).toHaveLength(2);
  });

  it('records the number of seasons on the series row for the grid (review #7)', async () => {
    await catalogRepo.replaceForSource('x9', 'series', {
      categories: [],
      items: [{ externalId: '3001', name: 'Example Drama' }],
    });
    await loadSeriesDetails(source, series('3001'));
    expect((await catalogRepo.get('series', series('3001').key))?.seasonCount).toBe(2);
  });

  it('a new sync or edited account refetches', async () => {
    await loadSeriesDetails(source, series('3001'));
    await loadSeriesDetails({ ...source, lastSyncAt: 11 }, series('3001'));
    await loadSeriesDetails({ ...source, lastSyncAt: 11 }, series('3001'));
    expect(requests).toHaveLength(2);
    await loadSeriesDetails({ ...source, lastSyncAt: 11, username: 'other' }, series('3001')).catch(
      () => undefined,
    );
    expect(requests).toHaveLength(3);
  });

  it('a failure propagates and is not cached', async () => {
    server.use(...xtreamHandlers({ error: 'http-500' }));
    await expect(loadSeriesDetails(source, series('3001'))).rejects.toBeInstanceOf(NetError);
    server.resetHandlers();
    await loadSeriesDetails(source, series('3001'));
    expect((await catalogRepo.getSeriesDetails(series('3001').key))?.seasons).toHaveLength(2);
  });

  it('an aborted request is not cached', async () => {
    const controller = new AbortController();
    const pending = loadSeriesDetails(source, series('3001'), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect((await catalogRepo.getSeriesDetails(series('3001').key))?.seasons).toEqual([]);
  });

  it('a source without a readable password fails before any request', async () => {
    const vault = { get: vi.fn(async (_ref: string) => undefined) };
    await expect(loadSeriesDetails(source, series('3001'), { vault })).rejects.toMatchObject({
      name: 'MissingCredentialsError',
    });
    expect(requests).toHaveLength(0);
  });
});

describe('localSeriesDetails (M3U)', () => {
  it('the entry is its own episode; S/E from its name, else 1/1', () => {
    const own = localSeriesDetails({ ...series('a'), name: 'Show S03E07' });
    expect(own.seasons).toEqual([
      {
        number: 3,
        episodes: [expect.objectContaining({ season: 3, number: 7, title: 'Show S03E07' })],
      },
    ]);
    const plain = localSeriesDetails(series('b'));
    expect(plain.seasons[0]?.episodes[0]).toMatchObject({ season: 1, number: 1 });
  });
});

describe('loadSeriesDetails (M3U, VOD-04)', () => {
  const m3u: Source = { ...source, id: 'm9', kind: 'm3u-url', serverUrl: undefined };
  const show: Series = { ...series('s1'), key: itemKey('m9', 'series', 's1'), sourceId: 'm9' };

  it('reads the seasons stored at import, without a request', async () => {
    const stored = {
      seriesKey: show.key,
      sourceId: 'm9',
      fetchedAt: 5,
      seasons: [
        { number: 1, episodes: [] },
        { number: 2, episodes: [] },
      ],
    };
    await catalogRepo.putSeriesDetails(stored);
    expect(await loadSeriesDetails(m3u, show)).toEqual(stored);
    expect(requests).toHaveLength(0);
  });

  it('falls back to the entry itself when nothing is stored', async () => {
    const single = { ...show, key: itemKey('m9', 'series', 'one'), externalId: 'one' };
    const details = await loadSeriesDetails(m3u, { ...single, name: 'Show S02E01' });
    expect(details.seasons).toEqual([
      { number: 2, episodes: [expect.objectContaining({ season: 2, number: 1 })] },
    ]);
  });
});
