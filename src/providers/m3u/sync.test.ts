// @vitest-environment node
// SRC-04/SRC-05: M3U-URL import end to end — MSW (the Xtream panel's `get.php` and ad-hoc list
// hosts) + fake-indexeddb + the real WebCrypto vault. Node environment: real WebCrypto and
// structured clone of CryptoKey in fake-indexeddb.
import { delay, http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { credentialVault } from '@/core/crypto';
import {
  catalogRepo,
  closeDatabase,
  episodeItemKey,
  favoritesRepo,
  historyRepo,
  itemKey,
  openDatabase,
  sourcesRepo,
  type CatalogItem,
  type ContentType,
  type Source,
} from '@/core/db';
import { clearLogBuffer, clearSecrets, getLogEntries } from '@/core/log';
import { WorkerTaskError, type TaskContext, type TaskProgress } from '@/core/worker';
import { XTREAM_TEST_BASE_URL, XTREAM_TEST_CREDENTIALS, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { M3uCatalogBuilder, UNCATEGORIZED_CATEGORY_ID, entryBaseId } from './catalog';
import { M3uParser, parseM3uText } from './parser';
import {
  isM3uSourceSyncing,
  listUrlSecrets,
  protectedCounts,
  storableUrlCheck,
  syncM3uSource,
  waitForM3uSourceIdle,
  type M3uSyncProgress,
  type SyncM3uDeps,
} from './sync';

describe('protectedCounts (UX-07)', () => {
  it('counts the DRM/DASH items per type; a show counts when every episode is protected', () => {
    const DRM = '#KODIPROP:inputstream.adaptive.license_type=clearkey';
    const builder = new M3uCatalogBuilder();
    const text = [
      '#EXTM3U',
      '#EXTINF:-1 group-title="News",Locked',
      DRM,
      'https://s.example.test/live/1.m3u8',
      '#EXTINF:-1 group-title="News",Dash',
      'https://s.example.test/live/2.mpd',
      '#EXTINF:-1 group-title="News",Open',
      'https://s.example.test/live/3.ts',
      '#EXTINF:-1 group-title="Films",Film',
      'https://s.example.test/movie/4.mp4',
      '#EXTINF:-1 group-title="Séries",Show S01E01',
      'https://s.example.test/v/5.mpd',
      '#EXTINF:-1 group-title="Séries",Other S01E01',
      'https://s.example.test/v/6.mp4',
    ].join('\n');
    for (const entry of parseM3uText(text).entries) builder.add(entry);
    expect(protectedCounts(builder.build())).toEqual({ live: 2, movies: 0, series: 1 });
  });
});

const server = createMswServer(...xtreamHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

const SOURCE_ID = 'm3u-1';
const SECRET_REF = `source:${SOURCE_ID}:url`;
const { username: USER, password: PASS } = XTREAM_TEST_CREDENTIALS;
const GET_PHP = `${XTREAM_TEST_BASE_URL}/get.php?username=${USER}&password=${PASS}&type=m3u_plus`;
const LIST_HOST = 'https://lists.example.test';
const NOW = Date.UTC(2026, 9, 28, 12);

async function seedSource(url = GET_PHP, extra: Partial<Source> = {}): Promise<void> {
  await sourcesRepo.put({
    id: SOURCE_ID,
    kind: 'm3u-url',
    name: 'My list',
    secretRef: SECRET_REF,
    prefs: { liveFormat: 'auto' },
    createdAt: 1,
    lastSyncStatus: 'never',
    stats: { live: 0, movies: 0, series: 0 },
    ...extra,
  });
  await credentialVault.put(SECRET_REF, url);
}

beforeEach(async () => {
  await openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
  clearLogBuffer();
});

afterEach(async () => {
  server.resetHandlers();
  await closeDatabase();
  clearSecrets();
});

function fakeCtx(onProgress?: (p: M3uSyncProgress, cancel: () => void) => void) {
  let cancelled = false;
  const seen: M3uSyncProgress[] = [];
  const cancel = () => {
    cancelled = true;
  };
  const ctx: TaskContext = {
    progress(p: TaskProgress) {
      seen.push({ ...(p as M3uSyncProgress) });
      onProgress?.(p as M3uSyncProgress, cancel);
    },
    get cancelled() {
      return cancelled;
    },
    throwIfCancelled() {
      if (cancelled) throw new WorkerTaskError('cancelled');
    },
  };
  return { ctx, seen, cancel };
}

const deps: SyncM3uDeps = { now: () => NOW, cancelPollMs: 5 };
const sync = (ctx = fakeCtx().ctx, extra: SyncM3uDeps = {}) =>
  syncM3uSource({ sourceId: SOURCE_ID }, ctx, { ...deps, ...extra });

async function rejection(p: Promise<unknown>): Promise<WorkerTaskError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(WorkerTaskError);
  return err as WorkerTaskError;
}

async function allItems(): Promise<CatalogItem[]> {
  const out: CatalogItem[] = [];
  for (const type of ['live', 'movie', 'series'] as ContentType[]) {
    for (const cat of await catalogRepo.listCategories(SOURCE_ID, type)) {
      out.push(...(await catalogRepo.listByCategory(type, cat.key)));
    }
  }
  return out;
}

/** Serves `body` at `${LIST_HOST}/list.m3u` in chunks, optionally pausing between them. */
function serveList(body: string, { chunk = 64, pauseMs = 0, status = 200 } = {}) {
  server.use(
    http.get(`${LIST_HOST}/list.m3u`, () => {
      const bytes = new TextEncoder().encode(body);
      let offset = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (offset >= bytes.length) {
            controller.close();
            return;
          }
          if (pauseMs > 0) await delay(pauseMs);
          controller.enqueue(bytes.slice(offset, offset + chunk));
          offset += chunk;
        },
      });
      return new HttpResponse(stream, {
        status,
        headers: { 'content-type': 'audio/x-mpegurl', 'content-length': String(bytes.length) },
      });
    }),
  );
}

const SMALL_LIST = [
  '#EXTM3U url-tvg="https://epg.example.test/a.xml.gz,https://epg.example.test/b.xml"',
  '#EXTINF:-1 tvg-id="one" group-title="News",One',
  'https://s.example.test/live/1.m3u8',
  '#EXTINF:-1,Two',
  'https://s.example.test/live/2.ts',
  '#EXTINF:-1 group-title="Films",Film',
  'https://s.example.test/movie/3.mp4',
  '#EXTINF:-1,Bad',
  'javascript:alert(1)',
  '',
].join('\n');

describe('syncM3uSource — success', () => {
  it('imports the Xtream get.php playlist with progress in bytes and entries (AC1)', async () => {
    await seedSource();
    const { ctx, seen } = fakeCtx();
    const result = await sync(ctx);

    expect(result.status).toBe('ok');
    expect(result.stats).toEqual({ live: 3, movies: 1, series: 1 });
    expect(result.entries).toBe(5);
    expect(result.bytes).toBeGreaterThan(0);

    const phases = seen.map((p) => p.phase);
    expect(phases[0]).toBe('download');
    expect(phases.at(-1)).toBe('done');
    expect(phases).toContain('write');
    expect(seen.filter((p) => p.phase === 'download').at(-1)?.done).toBe(result.bytes);
    expect(seen.filter((p) => p.phase === 'parse').at(-1)?.done).toBe(5);

    const source = await sourcesRepo.get(SOURCE_ID);
    expect(source).toMatchObject({
      lastSyncStatus: 'ok',
      lastSyncAt: NOW,
      stats: { live: 3, movies: 1, series: 1 },
      // UX-07: nothing protected, so "Hide protected content" has nothing to filter.
      protectedCounts: { live: 0, movies: 0, series: 0 },
    });
    expect(source?.lastSyncByType?.live).toMatchObject({ status: 'ok', items: 3 });
    // The header's xmltv.php URL embeds the credentials: not stored.
    expect(source?.epgUrls).toEqual([]);
    expect(result.epgUrls).toBe(0);

    const movie = (await allItems()).find((i) => i.type === 'movie');
    expect(movie?.streamUrl).toBe(`${XTREAM_TEST_BASE_URL}/movie/${USER}/${PASS}/2001.mp4`);
  });

  it('stores credential-free header EPG URLs, skips invalid entries, Uncategorized (AC9)', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    serveList(SMALL_LIST);
    const result = await sync();
    expect(result).toMatchObject({ status: 'ok', entries: 3, skipped: 1, epgUrls: 2 });
    expect(result.skippedByReason['unsupported-scheme']).toBe(1);
    const source = await sourcesRepo.get(SOURCE_ID);
    expect(source?.epgUrls).toEqual([
      'https://epg.example.test/a.xml.gz',
      'https://epg.example.test/b.xml',
    ]);
    const live = await catalogRepo.listCategories(SOURCE_ID, 'live');
    expect(live.map((c) => c.externalId)).toContain(UNCATEGORIZED_CATEGORY_ID);
    expect((await allItems()).every((i) => i.categoryKey !== undefined)).toBe(true);
  });

  it('keeps favourites across a re-import (stable keys) and replaces removed entries', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    serveList(SMALL_LIST);
    await sync();
    const one = (await allItems()).find((i) => i.name === 'One');
    expect(one).toBeDefined();
    await favoritesRepo.add(one!.key, 5);

    serveList(SMALL_LIST.replace('#EXTINF:-1,Two\nhttps://s.example.test/live/2.ts\n', ''));
    const result = await sync();
    expect(result.stats).toEqual({ live: 1, movies: 1, series: 0 });
    expect(await favoritesRepo.has(one!.key)).toBe(true);
    expect((await allItems()).find((i) => i.name === 'One')?.key).toBe(one!.key);
    expect(one!.key).toBe(itemKey(SOURCE_ID, 'live', one!.externalId));
  });

  it('a type absent from the new list is emptied (the list is the whole truth)', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    serveList(SMALL_LIST);
    await sync();
    serveList('#EXTM3U\n#EXTINF:-1,Only\nhttps://s.example.test/live/9.ts\n');
    const result = await sync();
    expect(result.stats).toEqual({ live: 1, movies: 0, series: 0 });
  });
});

// VOD-04: a list mixing live channels, movies and series lands in the right sections; episodes
// are grouped into shows and seasons, with keys that survive a re-import.
const MIXED_LIST = [
  '#EXTM3U',
  '#EXTINF:-1 group-title="Notícias",Canal Notícias',
  'https://s.example.test/hls/news.m3u8',
  '#EXTINF:-1 radio="true" group-title="Rádios",Rádio Um',
  'https://s.example.test/radio/um.m3u8',
  '#EXTINF:-1 group-title="Filmes | Ação",Um Filme (2024)',
  'https://s.example.test/hls/filme/index.m3u8',
  '#EXTINF:-1 group-title="Documentários",Documentário Exemplo',
  'https://s.example.test/files/doc.mp4',
  '#EXTINF:-1 media="true" group-title="Programa",Programa - 22/10/2026',
  'https://s.example.test/hls/prog-2210.m3u8',
  '#EXTINF:-1 group-title="Séries | Drama",Série Exemplo S01E01',
  'https://s.example.test/hls/se-s1e1.m3u8',
  '#EXTINF:-1 group-title="Séries | Drama",Série Exemplo S01E02',
  'https://s.example.test/hls/se-s1e2.m3u8',
  '#EXTINF:-1 group-title="Séries | Drama",Série Exemplo S02E01',
  'https://s.example.test/hls/se-s2e1.m3u8',
  '#EXTINF:-1 media="true" group-title="Talk",Talk T03E04 25-10-2026',
  'https://s.example.test/hls/talk-t3e4.m3u8',
  '#EXTINF:-1 group-title="Desporto",Jogo 1x2 Resumo',
  'https://s.example.test/hls/jogo.m3u8',
  '',
].join('\n');

describe('syncM3uSource — VOD-04 classification and grouping', () => {
  async function names(type: ContentType) {
    return (await allItems()).filter((i) => i.type === type).map((i) => i.name);
  }

  it('mixed content lands in Live, Movies and Series; episodes grouped by show and season', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    serveList(MIXED_LIST);
    const result = await sync();
    expect(result).toMatchObject({ status: 'ok', entries: 10, episodes: 4 });
    expect(result.stats).toEqual({ live: 3, movies: 3, series: 2 });
    // Stats + episodes account for every entry; so does the write progress (review #5).
    expect(result.stats.live + result.stats.movies + result.episodes!).toBe(result.entries);
    const source = await sourcesRepo.get(SOURCE_ID);
    expect(source?.lastSyncByType?.series).toMatchObject({ items: 2, episodes: 4 });
    expect(await names('live')).toEqual(['Canal Notícias', 'Rádio Um', 'Jogo 1x2 Resumo']);
    expect(await names('movie')).toEqual([
      'Um Filme (2024)',
      'Documentário Exemplo',
      'Programa - 22/10/2026',
    ]);
    expect(await names('series')).toEqual(['Série Exemplo', 'Talk']);

    const show = (await allItems()).find((i) => i.name === 'Série Exemplo');
    expect(show).toMatchObject({ seasonCount: 2 });
    const details = await catalogRepo.getSeriesDetails(show!.key);
    expect(details).toMatchObject({ sourceId: SOURCE_ID, seriesKey: show!.key });
    expect(details?.seasons.map((s) => [s.number, s.episodes.map((e) => e.number)])).toEqual([
      [1, [1, 2]],
      [2, [1]],
    ]);
    const episode = details!.seasons[0]!.episodes[1]!;
    expect(episode.key).toBe(episodeItemKey(show!.key, episode.externalId));
    expect(episode.streamUrl).toBe('https://s.example.test/hls/se-s1e2.m3u8');
  });

  it('series, episode keys and history survive a re-import with another order', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    serveList(MIXED_LIST);
    await sync();
    const show = (await allItems()).find((i) => i.name === 'Série Exemplo')!;
    const before = await catalogRepo.getSeriesDetails(show.key);
    const episode = before!.seasons[1]!.episodes[0]!;
    await historyRepo.upsert({ itemKey: episode.key, positionSec: 600, durationSec: 1800 });
    await historyRepo.upsert({ itemKey: show.key, episodeKey: episode.key, positionSec: 600 });
    await favoritesRepo.add(show.key, 5);

    // Same entries, reversed, plus a new episode: the show and its episodes keep their keys.
    const lines = MIXED_LIST.trim().split('\n');
    const pairs: string[][] = [];
    for (let i = 1; i < lines.length; i += 2) pairs.push(lines.slice(i, i + 2));
    const reversed = [
      lines[0]!,
      '#EXTINF:-1 group-title="Séries | Drama",Série Exemplo S02E02',
      'https://s.example.test/hls/se-s2e2.m3u8',
      ...pairs.reverse().flat(),
    ].join('\n');
    serveList(reversed);
    await sync();
    const again = (await allItems()).find((i) => i.name === 'Série Exemplo')!;
    expect(again.key).toBe(show.key);
    const after = await catalogRepo.getSeriesDetails(show.key);
    expect(after?.seasons[1]?.episodes.map((e) => e.key)).toContain(episode.key);
    expect(after?.seasons[1]?.episodes).toHaveLength(2);
    expect((await historyRepo.get(show.key))?.episodeKey).toBe(episode.key);
    expect(await favoritesRepo.has(show.key)).toBe(true);
  });

  it('write progress counts the episodes of grouped shows', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    serveList(MIXED_LIST);
    const { ctx, seen } = fakeCtx();
    await sync(ctx);
    // Rows written: 8 items (3 live, 3 movies, 2 shows) + 4 episodes.
    expect(seen.filter((p) => p.phase === 'write').at(-1)).toMatchObject({ done: 12, total: 12 });
  });

  it('moves pre-VOD-04 history and favourites of per-entry series rows to the grouped keys', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    // Before VOD-04 each episode entry was a series row of its own: `<src>:series:<entryId>`,
    // played as its only episode `<…>:ep:<entryId>` (the old localSeriesDetails).
    const entry = (name: string, url: string) => entryBaseId(url, name);
    const e101 = entry('Série Exemplo S01E01', 'https://s.example.test/hls/se-s1e1.m3u8');
    const e102 = entry('Série Exemplo S01E02', 'https://s.example.test/hls/se-s1e2.m3u8');
    const e201 = entry('Série Exemplo S02E01', 'https://s.example.test/hls/se-s2e1.m3u8');
    const oldKey = (id: string) => itemKey(SOURCE_ID, 'series', id);
    const oldEp = (id: string) => episodeItemKey(oldKey(id), id);
    await historyRepo.set({
      itemKey: oldEp(e101),
      positionSec: 1800,
      durationSec: 1800,
      completed: true,
      lastWatchedAt: 100,
    });
    await historyRepo.set({
      itemKey: oldKey(e101),
      episodeKey: oldEp(e101),
      positionSec: 1800,
      durationSec: 1800,
      completed: true,
      lastWatchedAt: 100,
    });
    // Only the series entry (no episode entry) for S01E02: newer.
    await historyRepo.set({
      itemKey: oldKey(e102),
      episodeKey: oldEp(e102),
      positionSec: 300,
      durationSec: 1800,
      lastWatchedAt: 200,
    });
    await favoritesRepo.add(oldKey(e201), 50);
    await favoritesRepo.add(oldKey(e102), 70);
    // Unrelated data stays.
    await favoritesRepo.add(itemKey(SOURCE_ID, 'live', 'other'), 1);

    serveList(MIXED_LIST);
    const result = await sync();
    expect(result.status).toBe('ok');
    const show = (await allItems()).find((i) => i.name === 'Série Exemplo')!;
    const ep = (id: string) => episodeItemKey(show.key, id);

    expect(await historyRepo.get(ep(e101))).toMatchObject({ positionSec: 1800, completed: true });
    expect(await historyRepo.get(ep(e102))).toMatchObject({ positionSec: 300, completed: false });
    expect(await historyRepo.get(show.key)).toMatchObject({
      episodeKey: ep(e102),
      positionSec: 300,
      lastWatchedAt: 200,
    });
    for (const id of [e101, e102, e201]) {
      expect(await historyRepo.get(oldKey(id))).toBeUndefined();
      expect(await historyRepo.get(oldEp(id))).toBeUndefined();
      expect(await favoritesRepo.has(oldKey(id))).toBe(false);
    }
    // One favourite for the show, with the earliest date.
    const favorites = await favoritesRepo.list(SOURCE_ID, 'series');
    expect(favorites).toEqual([expect.objectContaining({ itemKey: show.key, addedAt: 50 })]);
    expect(await favoritesRepo.has(itemKey(SOURCE_ID, 'live', 'other'))).toBe(true);

    // Idempotent: a second sync changes nothing.
    const before = JSON.stringify([await historyRepo.get(show.key), favorites]);
    serveList(MIXED_LIST);
    await sync();
    expect(
      JSON.stringify([
        await historyRepo.get(show.key),
        await favoritesRepo.list(SOURCE_ID, 'series'),
      ]),
    ).toBe(before);
  });

  it('a show removed from the list loses its stored episodes', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    serveList(MIXED_LIST);
    await sync();
    const show = (await allItems()).find((i) => i.name === 'Talk')!;
    expect(await catalogRepo.getSeriesDetails(show.key)).toBeDefined();
    serveList(MIXED_LIST.replace(/#EXTINF[^\n]*Talk T03E04[^\n]*\n[^\n]*\n/, ''));
    const result = await sync();
    expect(result.stats.series).toBe(1);
    expect(await catalogRepo.getSeriesDetails(show.key)).toBeUndefined();
  });
});

describe('syncM3uSource — failures keep the previous catalogue', () => {
  async function seedWithData() {
    await seedSource(`${LIST_HOST}/list.m3u`);
    serveList(SMALL_LIST);
    await sync();
    return allItems();
  }

  it('a response that is not an M3U list → not-m3u (AC4)', async () => {
    const before = await seedWithData();
    server.use(
      http.get(`${LIST_HOST}/list.m3u`, () =>
        HttpResponse.html('<!doctype html><html><body>Login</body></html>'),
      ),
    );
    const result = await sync();
    expect(result).toMatchObject({ status: 'error', error: 'not-m3u' });
    expect(await allItems()).toEqual(before);
    const source = await sourcesRepo.get(SOURCE_ID);
    expect(source).toMatchObject({ lastSyncStatus: 'error', lastSyncError: 'not-m3u' });
    expect(source?.lastSyncAt).toBe(NOW);
    expect(source?.lastSyncByType?.live).toMatchObject({ status: 'error', lastOkAt: NOW });
  });

  it('an empty body is not an M3U list either', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    serveList('');
    expect(await sync()).toMatchObject({ status: 'error', error: 'not-m3u' });
  });

  it('a header without valid entries → empty-list', async () => {
    const before = await seedWithData();
    serveList('#EXTM3U\n#EXTINF:-1,X\nfile:///etc/passwd\n');
    expect(await sync()).toMatchObject({ status: 'error', error: 'empty-list' });
    expect(await allItems()).toEqual(before);
  });

  it('HTTP 404 → http with status; 403 → auth', async () => {
    await seedWithData();
    serveList('nope', { status: 404 });
    expect(await sync()).toMatchObject({ status: 'error', error: 'http', httpStatus: 404 });
    serveList('', { status: 403 });
    expect(await sync()).toMatchObject({ status: 'error', error: 'auth', httpStatus: 403 });
  });

  it('a blocked request (CORS / mixed content look the same) → blocked + hint (AC3)', async () => {
    const before = await seedWithData();
    server.use(http.get(`${LIST_HOST}/list.m3u`, () => HttpResponse.error()));
    expect(await sync()).toMatchObject({ status: 'error', error: 'blocked', hint: 'cors' });
    expect(await allItems()).toEqual(before);
  });

  it('a stalled download → timeout (inactivity)', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    // A direct fetchImpl (no MSW socket): the body sends one line, then nothing.
    let cancelled = false;
    const fetchImpl = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('#EXTM3U\n'));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
      );
    expect(await sync(undefined, { inactivityTimeoutMs: 80, fetchImpl })).toMatchObject({
      status: 'error',
      error: 'timeout',
    });
    expect(cancelled).toBe(true);
  });

  it('a missing vault secret → credentials-lost', async () => {
    await seedSource();
    await credentialVault.delete(SECRET_REF);
    expect(await sync()).toMatchObject({ status: 'error', error: 'credentials-lost' });
  });

  it('rejects unknown and non-M3U sources', async () => {
    expect((await rejection(sync())).kind).toBe('failed');
    await sourcesRepo.put({
      id: SOURCE_ID,
      kind: 'xtream',
      name: 'x',
      prefs: { liveFormat: 'auto' },
      createdAt: 1,
      lastSyncStatus: 'never',
      stats: { live: 0, movies: 0, series: 0 },
    });
    expect((await rejection(sync())).message).toMatch(/not an M3U URL source/);
  });
});

describe('syncM3uSource — cancellation and removal', () => {
  it('cancel during the download leaves the previous data and the source row intact', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    serveList(SMALL_LIST);
    await sync();
    const before = await allItems();
    const sourceBefore = await sourcesRepo.get(SOURCE_ID);

    serveList(SMALL_LIST.replaceAll('One', 'Uno'), { chunk: 16, pauseMs: 5 });
    const { ctx } = fakeCtx((p, cancel) => {
      if (p.phase === 'parse') cancel();
    });
    const err = await rejection(sync(ctx));
    expect(err.kind).toBe('cancelled');
    expect(await allItems()).toEqual(before);
    expect(await sourcesRepo.get(SOURCE_ID)).toEqual(sourceBefore);
    expect(isM3uSourceSyncing(SOURCE_ID)).toBe(false);
  });

  it('a source removed mid-import is not resurrected and gets no orphan rows', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    serveList(SMALL_LIST, { chunk: 16, pauseMs: 5 });
    let removal: Promise<void> | undefined;
    const { ctx } = fakeCtx((p) => {
      if (p.phase === 'parse' && !removal) removal = sourcesRepo.remove(SOURCE_ID);
    });
    const err = await rejection(sync(ctx));
    await removal;
    expect(err.kind).toBe('cancelled');
    expect(err.message).toMatch(/source-removed/);
    expect(await sourcesRepo.get(SOURCE_ID)).toBeUndefined();
    expect(await catalogRepo.count(SOURCE_ID, 'live')).toBe(0);
    expect(await catalogRepo.listCategories(SOURCE_ID, 'live')).toEqual([]);
  });

  it('imports of the same source are serialised', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    serveList(SMALL_LIST, { chunk: 32, pauseMs: 2 });
    const a = sync();
    const b = sync();
    expect(isM3uSourceSyncing(SOURCE_ID)).toBe(true);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.status).toBe('ok');
    expect(rb.status).toBe('ok');
    await waitForM3uSourceIdle(SOURCE_ID);
    expect(isM3uSourceSyncing(SOURCE_ID)).toBe(false);
  });
});

describe('credentials never leave the vault except as stream URLs', () => {
  it('not in logs, progress, the result, the source row, categories or non-URL fields', async () => {
    await seedSource();
    const { ctx, seen } = fakeCtx();
    const result = await sync(ctx);
    // Also a failing run (logs with the request target).
    server.use(http.get(`${XTREAM_TEST_BASE_URL}/get.php`, () => HttpResponse.error()));
    await sync();

    const leaks = (text: string) => text.includes(PASS) || text.includes(`password=`);
    expect(leaks(JSON.stringify(getLogEntries()))).toBe(false);
    expect(leaks(JSON.stringify(seen))).toBe(false);
    expect(leaks(JSON.stringify(result))).toBe(false);
    expect(leaks(JSON.stringify(await sourcesRepo.get(SOURCE_ID)))).toBe(false);
    for (const type of ['live', 'movie', 'series'] as ContentType[]) {
      expect(leaks(JSON.stringify(await catalogRepo.listCategories(SOURCE_ID, type)))).toBe(false);
    }
    const items = await allItems();
    expect(items.length).toBe(5);
    for (const item of items) {
      const { streamUrl, ...rest } = item;
      const others = rest; // streamPath included: it is empty for M3U items
      // Documented: M3U stream URLs are stored as-is. A grouped show (VOD-04) has none: its
      // episodes keep their own.
      if (item.type === 'series') expect(streamUrl).toBeUndefined();
      else expect(streamUrl).toContain(PASS);
      expect(leaks(JSON.stringify(others))).toBe(false);
    }
    const show = items.find((i) => i.type === 'series');
    const details = await catalogRepo.getSeriesDetails(show!.key);
    const episodes = details?.seasons.flatMap((s) => s.episodes) ?? [];
    expect(episodes).toHaveLength(1);
    for (const { streamUrl, ...rest } of episodes) {
      expect(streamUrl).toContain(PASS);
      expect(leaks(JSON.stringify(rest))).toBe(false);
    }
  });
});

describe('list URL secrets', () => {
  it('collects credential-like query values and long path tokens', () => {
    const url = new URL(
      'https://h.example.test/pl/AbCdEfGhIjKlMnOpQr/get.php?username=jdoe&password=testpass&type=m3u_plus&x=1',
    );
    expect(listUrlSecrets(url).sort()).toEqual(['AbCdEfGhIjKlMnOpQr', 'jdoe', 'testpass']);
  });

  it('storableUrlCheck rejects URLs with credential params or list secrets', () => {
    const ok = storableUrlCheck(['testpass']);
    expect(ok('https://img.example.test/a.png')).toBe(true);
    expect(ok('https://img.example.test/a.png?token=x')).toBe(false);
    expect(ok('https://h.example.test/xmltv.php?u=a&p=testpass')).toBe(false);
  });
});

describe('review regressions (SRC-04/SRC-05)', () => {
  const bodyResponse = (text: string, headers: Record<string, string> = {}, chunk = 32) => {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.length) controller.close();
          else {
            controller.enqueue(bytes.slice(offset, offset + chunk));
            offset += chunk;
          }
        },
      }),
      { headers },
    );
  };
  const fetching =
    (text: string, headers: Record<string, string> = {}, chunk = 32) =>
    () =>
      Promise.resolve(bodyResponse(text, headers, chunk));

  it('#1 a storage failure changes nothing and is reported as storage', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    serveList(SMALL_LIST);
    await sync();
    const before = await allItems();
    vi.spyOn(catalogRepo, 'replaceAllForExistingSource').mockRejectedValueOnce(
      new Error('QuotaExceededError'),
    );
    serveList(SMALL_LIST.replaceAll('One', 'Uno'));
    expect(await sync()).toMatchObject({ status: 'error', error: 'storage' });
    expect(await allItems()).toEqual(before);
    vi.restoreAllMocks();
  });

  it('#2 a compressed body has no total; done never exceeds a (lying) total', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    const gz = fakeCtx();
    await sync(gz.ctx, {
      fetchImpl: fetching(SMALL_LIST, { 'content-encoding': 'gzip', 'content-length': '40' }),
    });
    const gzDownloads = gz.seen.filter((p) => p.phase === 'download' && p.done > 0);
    expect(gzDownloads.length).toBeGreaterThan(0);
    expect(gzDownloads.every((p) => p.total === undefined)).toBe(true);

    const short = fakeCtx();
    await sync(short.ctx, { fetchImpl: fetching(SMALL_LIST, { 'content-length': '50' }) });
    for (const p of short.seen.filter((m) => m.phase === 'download')) {
      if (p.total !== undefined) expect(p.done).toBeLessThanOrEqual(p.total);
    }
  });

  it('#3 a list without #EXTM3U is accepted; JSON / HTML / empty bodies are not', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    const noHeader = SMALL_LIST.split('\n').slice(1).join('\n');
    expect(await sync(undefined, { fetchImpl: fetching(noHeader) })).toMatchObject({
      status: 'ok',
      entries: 3,
    });
    const commentFirst = `# my list\n${noHeader}`;
    expect(await sync(undefined, { fetchImpl: fetching(commentFirst) })).toMatchObject({
      status: 'ok',
    });
    for (const body of ['{"user_info":{}}', '<!doctype html><p>x</p>', '']) {
      expect(await sync(undefined, { fetchImpl: fetching(body) })).toMatchObject({
        status: 'error',
        error: 'not-m3u',
      });
    }
    // A large non-playlist body stops after the sniff window instead of downloading everything.
    const big = `<html>${'x'.repeat(300 * 1024)}</html>`;
    const result = await sync(undefined, { fetchImpl: fetching(big, {}, 16 * 1024) });
    expect(result).toMatchObject({ status: 'error', error: 'not-m3u' });
    expect(result.bytes).toBeLessThan(100 * 1024);
  });

  it('#4 Xtream-style path credentials are secrets: redacted and never stored', async () => {
    const url = 'https://lists.example.test/playlist/john/s3cr3t/m3u_plus';
    await seedSource(url);
    const list = [
      '#EXTM3U url-tvg="https://lists.example.test/xmltv/john/s3cr3t/epg.xml,https://epg.example.test/ok.xml"',
      '#EXTINF:-1 tvg-logo="https://lists.example.test/logo/s3cr3t/a.png" catchup-source="https://lists.example.test/timeshift/john/s3cr3t/{utc}/1.ts" catchup="default",A',
      'https://lists.example.test/live/john/s3cr3t/1.ts',
    ].join('\n');
    const result = await sync(undefined, { fetchImpl: fetching(list) });
    expect(listUrlSecrets(new URL(url))).toEqual(expect.arrayContaining(['john', 's3cr3t']));
    expect(result.status).toBe('ok');
    const source = await sourcesRepo.get(SOURCE_ID);
    expect(source?.epgUrls).toEqual(['https://epg.example.test/ok.xml']);
    const [item] = await allItems();
    const { streamUrl, ...rest } = item!;
    expect(streamUrl).toContain('s3cr3t');
    expect(JSON.stringify(rest)).not.toContain('s3cr3t');
    // Any text the redactor sees loses the secret.
    server.use(http.get(url, () => HttpResponse.error()));
    await sync();
    expect(JSON.stringify(getLogEntries())).not.toContain('s3cr3t');
  });

  it('#6 a non-network exception is internal (not blocked) and fails the task', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    vi.spyOn(M3uParser.prototype, 'write').mockImplementationOnce(() => {
      throw new TypeError('parser bug');
    });
    const err = await rejection(sync(undefined, { fetchImpl: fetching(SMALL_LIST) }));
    vi.restoreAllMocks();
    expect(err.kind).toBe('failed');
    expect(err.message).toMatch(/internal/);
    expect(await sourcesRepo.get(SOURCE_ID)).toMatchObject({
      lastSyncStatus: 'error',
      lastSyncError: 'internal',
    });
    expect(getLogEntries().some((e) => e.level === 'error')).toBe(true);
  });

  it('#7 the final download and parse totals are sent spaced, before the write phase', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    const stamps: Array<{ phase: string; done: number; at: number }> = [];
    const { ctx } = fakeCtx((p) => stamps.push({ phase: p.phase, done: p.done, at: Date.now() }));
    const result = await sync(ctx, { fetchImpl: fetching(SMALL_LIST) });
    const firstWrite = stamps.findIndex((s) => s.phase === 'write');
    const before = stamps.slice(0, firstWrite);
    const lastDownload = before.filter((s) => s.phase === 'download').at(-1);
    const lastParse = before.filter((s) => s.phase === 'parse').at(-1);
    expect(lastDownload?.done).toBe(result.bytes);
    expect(lastParse?.done).toBe(result.entries);
    // Each final message is at least the throttle interval (50 ms) after the previous one.
    expect(lastParse!.at - lastDownload!.at).toBeGreaterThanOrEqual(50);
    expect(stamps[firstWrite]!.at - lastParse!.at).toBeGreaterThanOrEqual(50);
  });

  it('#8 the stream URL is stored once (streamUrl), streamPath stays empty', async () => {
    await seedSource(`${LIST_HOST}/list.m3u`);
    await sync(undefined, { fetchImpl: fetching(SMALL_LIST) });
    for (const item of await allItems()) {
      expect(item.streamUrl).toMatch(/^https:\/\//);
      if ('streamPath' in item) expect(item.streamPath).toBe('');
    }
  });
});
