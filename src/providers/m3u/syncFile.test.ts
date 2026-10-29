// @vitest-environment node
// SRC-06: import / refresh of a local M3U file (`syncM3uFileSource`) — the same streaming parser,
// classification (VOD-04), write and outcomes as the URL import, with a `File` read through
// `file.stream()` instead of a download. fake-indexeddb; no network.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  catalogRepo,
  closeDatabase,
  favoritesRepo,
  itemKey,
  openDatabase,
  sourcesRepo,
  type Source,
} from '@/core/db';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import { WorkerTaskError, type TaskContext, type TaskProgress } from '@/core/worker';
import { entryBaseId } from './catalog';
import { MAX_BYTES, syncM3uFileSource, waitForM3uSourceIdle, type M3uSyncProgress } from './sync';

const SOURCE_ID = 'file-1';
const NOW = Date.UTC(2026, 9, 29, 12);

const LIST = [
  '#EXTM3U url-tvg="https://epg.example.test/guide.xml"',
  '#EXTINF:-1 tvg-logo="https://logos.example.test/news.png" group-title="Notícias",Canal Notícias',
  'https://s.example.test/live/news.ts',
  '#EXTINF:-1 tvg-logo="https://logos.example.test/x.png?username=joe&password=secret1" group-title="Notícias",Canal Dois',
  'https://s.example.test/live/two.ts',
  '#EXTINF:-1 group-title="Filmes | Ação",Um Filme (2024)',
  'https://s.example.test/hls/filme/index.m3u8',
  '#EXTINF:-1 group-title="Séries | Drama",Série Exemplo S01E01',
  'https://s.example.test/hls/se-s1e1.m3u8',
  '#EXTINF:-1 group-title="Séries | Drama",Série Exemplo S01E02',
  'https://s.example.test/hls/se-s1e2.m3u8',
  '',
].join('\n');

async function seedFileSource(extra: Partial<Source> = {}): Promise<void> {
  await sourcesRepo.put({
    id: SOURCE_ID,
    kind: 'm3u-file',
    name: 'My file',
    prefs: { liveFormat: 'auto' },
    createdAt: 1,
    lastSyncStatus: 'never',
    stats: { live: 0, movies: 0, series: 0 },
    ...extra,
  });
}

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

const file = (body: string, name = 'list.m3u') =>
  new File([body], name, { type: 'audio/x-mpegurl' });

const sync = (f: Blob, ctx = fakeCtx().ctx, afterSync?: (id: string) => void) =>
  syncM3uFileSource({ sourceId: SOURCE_ID, file: f }, ctx, {
    now: () => NOW,
    cancelPollMs: 5,
    ...(afterSync ? { afterSync } : {}),
  });

/** A file read in many small chunks (a pull per chunk). */
function chunkedFile(body: string, chunk = 16): Blob {
  const bytes = new TextEncoder().encode(body);
  const blob = new Blob([bytes]);
  blob.stream = () => {
    let at = 0;
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      async pull(controller) {
        await new Promise((r) => setTimeout(r, 1));
        if (at >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(at, at + chunk));
        at += chunk;
      },
    });
  };
  return blob;
}

beforeEach(async () => {
  await openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
  clearLogBuffer();
});

afterEach(async () => {
  await closeDatabase();
});

describe('syncM3uFileSource (SRC-06)', () => {
  it('reads the file with progress (phase read) and stores the classified catalogue (AC1, VOD-04)', async () => {
    await seedFileSource();
    const { ctx, seen } = fakeCtx();
    const afterSync = vi.fn();
    const f = file(LIST);
    const result = await sync(f, ctx, afterSync);

    expect(result).toMatchObject({ status: 'ok', bytes: f.size, entries: 5, episodes: 2 });
    expect(result.stats).toEqual({ live: 2, movies: 1, series: 1 });
    const phases = new Set(seen.map((p) => p.phase));
    expect(phases.has('read')).toBe(true);
    expect(phases.has('download')).toBe(false);
    expect(seen.filter((p) => p.phase === 'read').at(-1)).toEqual({
      phase: 'read',
      done: f.size,
      total: f.size,
    });
    expect(seen.at(-1)).toMatchObject({ phase: 'done' });

    const source = await sourcesRepo.get(SOURCE_ID);
    expect(source).toMatchObject({
      lastSyncStatus: 'ok',
      lastSyncAt: NOW,
      stats: result.stats,
      epgUrls: ['https://epg.example.test/guide.xml'],
    });
    // No URL and nothing in the vault for a file source.
    expect(source?.secretRef).toBeUndefined();
    // Search index rebuild hook (SCH-01).
    expect(afterSync).toHaveBeenCalledWith(SOURCE_ID);
  });

  it('drops stored image URLs that carry credentials (no list URL to take secrets from)', async () => {
    await seedFileSource();
    await sync(file(LIST));
    const categories = await catalogRepo.listCategories(SOURCE_ID, 'live');
    const items = (
      await Promise.all(categories.map((c) => catalogRepo.listByCategory('live', c.key)))
    ).flat();
    const two = items.find((i) => i.name === 'Canal Dois');
    expect(two).toBeDefined();
    expect(JSON.stringify(two)).not.toContain('secret1');
    expect(items.find((i) => i.name === 'Canal Notícias')?.logo).toBe(
      'https://logos.example.test/news.png',
    );
  });

  it('a refresh with a new file replaces the catalogue and keeps favourites (stable keys)', async () => {
    await seedFileSource();
    await sync(file(LIST));
    const key = itemKey(
      SOURCE_ID,
      'live',
      entryBaseId('https://s.example.test/live/news.ts', 'Canal Notícias'),
    );
    const liveKeys = async () => {
      const categories = await catalogRepo.listCategories(SOURCE_ID, 'live');
      const items = await Promise.all(
        categories.map((c) => catalogRepo.listByCategory('live', c.key)),
      );
      return items.flat().map((i) => i.key);
    };
    expect(await liveKeys()).toContain(key);
    await favoritesRepo.add(key, 5);
    const smaller = LIST.split('\n').slice(0, 3).join('\n');
    const result = await sync(file(smaller, 'list-v2.m3u'));
    expect(result.stats).toEqual({ live: 1, movies: 0, series: 0 });
    expect(await liveKeys()).toEqual([key]);
    expect(await favoritesRepo.has(key)).toBe(true);
  });

  it('a file that is not an M3U list → not-m3u; the previous catalogue stays', async () => {
    await seedFileSource();
    await sync(file(LIST));
    const result = await sync(file('<html><body>Not a list</body></html>', 'page.html'));
    expect(result).toMatchObject({ status: 'error', error: 'not-m3u' });
    expect(await catalogRepo.count(SOURCE_ID, 'live')).toBe(2);
    expect(await sourcesRepo.get(SOURCE_ID)).toMatchObject({
      lastSyncStatus: 'error',
      lastSyncError: 'not-m3u',
      lastSyncAt: NOW,
    });
  });

  it('an empty file → not-m3u; a header-only file → empty-list', async () => {
    await seedFileSource();
    expect(await sync(file(''))).toMatchObject({ status: 'error', error: 'not-m3u' });
    expect(await sync(file('#EXTM3U\n'))).toMatchObject({ status: 'error', error: 'empty-list' });
  });

  it('a file larger than MAX_BYTES → too-large before reading a byte', async () => {
    await seedFileSource();
    const big = new Blob(['#EXTM3U\n']);
    Object.defineProperty(big, 'size', { value: MAX_BYTES + 1 });
    const stream = vi.spyOn(big, 'stream');
    const result = await sync(big);
    expect(result).toMatchObject({ status: 'error', error: 'too-large', bytes: 0 });
    expect(stream).not.toHaveBeenCalled();
  });

  it('a file that can no longer be read → file-unreadable', async () => {
    await seedFileSource();
    const gone = new Blob([LIST]);
    gone.stream = () =>
      new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull(controller) {
          controller.error(new DOMException('The file changed', 'NotReadableError'));
        },
      });
    const result = await sync(gone);
    expect(result).toMatchObject({ status: 'error', error: 'file-unreadable' });
    expect(await sourcesRepo.get(SOURCE_ID)).toMatchObject({ lastSyncError: 'file-unreadable' });
  });

  it('cancel while reading leaves the previous data and the source row intact', async () => {
    await seedFileSource();
    await sync(file(LIST));
    const before = await sourcesRepo.get(SOURCE_ID);
    const { ctx } = fakeCtx((p, cancel) => {
      if (p.phase === 'read' && p.done > 0) cancel();
    });
    const body = `${LIST}${LIST.split('\n').slice(1).join('\n').repeat(20)}`;
    const err = await sync(chunkedFile(body), ctx).catch((e: unknown) => e);
    expect((err as WorkerTaskError).kind).toBe('cancelled');
    await waitForM3uSourceIdle(SOURCE_ID);
    expect(await sourcesRepo.get(SOURCE_ID)).toEqual(before);
    expect(await catalogRepo.count(SOURCE_ID, 'live')).toBe(2);
  });

  it('rejects a URL source (and a file task without a file)', async () => {
    await sourcesRepo.put({
      id: SOURCE_ID,
      kind: 'm3u-url',
      name: 'URL list',
      secretRef: `source:${SOURCE_ID}:url`,
      prefs: { liveFormat: 'auto' },
      createdAt: 1,
      lastSyncStatus: 'never',
      stats: { live: 0, movies: 0, series: 0 },
    });
    const err = await sync(file(LIST)).catch((e: unknown) => e);
    expect((err as WorkerTaskError).kind).toBe('failed');
    const noFile = await syncM3uFileSource(
      { sourceId: SOURCE_ID, file: 'text' as unknown as Blob },
      fakeCtx().ctx,
    ).catch((e: unknown) => e);
    expect((noFile as WorkerTaskError).kind).toBe('failed');
  });

  it('never logs the file name or its content', async () => {
    await seedFileSource();
    await sync(file(LIST, 'private-name.m3u'));
    const logs = JSON.stringify(getLogEntries());
    expect(logs).not.toContain('private-name');
    expect(logs).not.toContain('se-s1e1');
  });
});
