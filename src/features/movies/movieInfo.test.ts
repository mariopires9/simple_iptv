// VOD-02 AC1: get_vod_info through the synthetic MSW panel, cached 24 h per movie.
import { delay, http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Movie, Source } from '@/core/db';
import { clearLogBuffer, clearSecrets, getLogEntries } from '@/core/log';
import {
  XTREAM_TEST_BASE_URL,
  XTREAM_TEST_CREDENTIALS,
  xtreamFixtures,
  xtreamHandlers,
} from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import {
  INFO_TTL_MS,
  MissingCredentialsError,
  clearInfoCache,
  loadMovieInfo,
  xtreamStreamId,
} from './movieInfo';

const requests: URL[] = [];
const server = createMswServer(...xtreamHandlers());
server.events.on('request:start', ({ request }) => {
  requests.push(new URL(request.url));
});
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  requests.length = 0;
  clearInfoCache();
  clearSecrets();
  clearLogBuffer();
});
afterAll(() => server.close());

const { username, password } = XTREAM_TEST_CREDENTIALS;
const vault = { get: vi.fn(() => Promise.resolve<string | undefined>(password)) };

const source: Source = {
  id: 'x1',
  kind: 'xtream',
  name: 'Panel',
  serverUrl: XTREAM_TEST_BASE_URL,
  username,
  secretRef: 'xtream:x1',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};

const movie = (id: string, streamPath = `${id}.mp4`): Movie => ({
  key: `x1:movie:${id}`,
  sourceId: 'x1',
  type: 'movie',
  externalId: id,
  name: `Movie ${id}`,
  order: 0,
  streamPath,
});

const infoRequests = () => requests.filter((u) => u.searchParams.get('action') === 'get_vod_info');

describe('loadMovieInfo', () => {
  it('requests get_vod_info with the stream id and maps the answer', async () => {
    const info = await loadMovieInfo(source, movie('2001'), { vault });
    expect(info).toMatchObject({ year: 2024, rating: 7.1, durationSec: 5, ext: 'mp4' });
    expect(infoRequests()).toHaveLength(1);
    expect(infoRequests()[0]?.searchParams.get('vod_id')).toBe('2001');
  });

  it('caches the answer for 24 h per movie, then fetches again', async () => {
    let now = 1_000;
    const deps = { vault, now: () => now };
    await loadMovieInfo(source, movie('2001'), deps);
    now += INFO_TTL_MS - 1;
    await loadMovieInfo(source, movie('2001'), deps);
    expect(infoRequests()).toHaveLength(1);
    await loadMovieInfo(source, movie('2002'), deps);
    expect(infoRequests()).toHaveLength(2);
    now += 1;
    await loadMovieInfo(source, movie('2001'), deps);
    expect(infoRequests()).toHaveLength(3);
  });

  it('editing or syncing the source invalidates its cached details (review #5)', async () => {
    await loadMovieInfo(source, movie('2001'), { vault });
    await loadMovieInfo(source, movie('2001'), { vault });
    expect(infoRequests()).toHaveLength(1);
    await loadMovieInfo({ ...source, lastSyncAt: 5 }, movie('2001'), { vault });
    expect(infoRequests()).toHaveLength(2);
    // A re-entered password (new vault reference).
    await loadMovieInfo({ ...source, lastSyncAt: 5, secretRef: 'xtream:x1:v2' }, movie('2001'), {
      vault,
    });
    expect(infoRequests()).toHaveLength(3);
    await loadMovieInfo({ ...source, id: 'x2' }, movie('2001'), { vault });
    expect(infoRequests()).toHaveLength(4);
  });

  it('an aborted request rejects, is not cached, and the next call fetches again', async () => {
    server.use(
      http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, async () => {
        await delay(50);
        return HttpResponse.json(xtreamFixtures.vodInfo);
      }),
    );
    const controller = new AbortController();
    const pending = loadMovieInfo(source, movie('2001'), { vault, signal: controller.signal });
    await vi.waitFor(() => expect(infoRequests()).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    await loadMovieInfo(source, movie('2001'), { vault });
    expect(infoRequests()).toHaveLength(2);
    // Already aborted before starting: no request at all.
    const aborted = new AbortController();
    aborted.abort();
    clearInfoCache();
    await expect(
      loadMovieInfo(source, movie('2001'), { vault, signal: aborted.signal }),
    ).rejects.toBeDefined();
    expect(infoRequests()).toHaveLength(2);
  });

  it('failures are not cached', async () => {
    server.use(...xtreamHandlers({ error: 'http-500' }));
    await expect(loadMovieInfo(source, movie('2001'), { vault })).rejects.toMatchObject({
      kind: 'http',
    });
    server.resetHandlers();
    await expect(loadMovieInfo(source, movie('2001'), { vault })).resolves.toMatchObject({
      year: 2024,
    });
  });

  it('without credentials, fails without a request', async () => {
    const noSecret = { ...source };
    delete noSecret.secretRef;
    await expect(loadMovieInfo(noSecret, movie('2001'), { vault })).rejects.toBeInstanceOf(
      MissingCredentialsError,
    );
    const empty = { get: () => Promise.resolve(undefined) };
    await expect(loadMovieInfo(source, movie('2001'), { vault: empty })).rejects.toBeInstanceOf(
      MissingCredentialsError,
    );
    expect(requests).toHaveLength(0);
  });

  it('never writes the credentials to the log, even on errors', async () => {
    server.use(http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, () => HttpResponse.text('oops')));
    await loadMovieInfo(source, movie('2001'), { vault }).catch(() => undefined);
    const dump = JSON.stringify(getLogEntries());
    expect(dump).not.toContain(password);
  });

  it('xtreamStreamId strips the extension', () => {
    expect(xtreamStreamId(movie('7', '7.mkv'))).toBe('7');
    expect(xtreamStreamId(movie('7', '7'))).toBe('7');
    expect(xtreamStreamId(movie('7', ''))).toBe('7');
  });
});
