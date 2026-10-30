// @vitest-environment node
// EPG-02 AC1/AC2/AC4 + EPG-03 AC4: XMLTV import end to end — plain/gzip/xz bodies, the
// −2 h…+48 h window, purge of finished programmes, matching coverage, proxy rewriter.
// fake-indexeddb + stubbed fetch; synthetic hosts and data only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  openDatabase,
  epgRepo,
  sourcesRepo,
  type Channel,
  type EpgProgram,
  type Source,
} from '@/core/db';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import type { FetchImpl } from '@/core/net';
import type { TaskContext } from '@/core/worker';
import { importEpg, isEpgDue } from './import';

const NOW = Date.UTC(2026, 9, 30, 12);
const SOURCE_ID = 'm3u-epg';
const EPG_URL = 'https://epg.example.test/guide.xml';
const H = 60 * 60 * 1000;

const ctx: TaskContext = {
  progress() {},
  cancelled: false,
  throwIfCancelled() {},
};

/** XMLTV time in UTC. */
const time = (ms: number) =>
  `${new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)} +0000`;

const programme = (channel: string, start: number, end: number, title: string) =>
  `<programme start="${time(start)}" stop="${time(end)}" channel="${channel}"><title>${title}</title></programme>`;

const FEED = `<?xml version="1.0"?><tv>
<channel id="one.test"><display-name>Canal Um</display-name></channel>
<channel id="two.test"><display-name>Canal Dois</display-name></channel>
<channel id="dup.a"><display-name>Twin</display-name></channel>
<channel id="dup.b"><display-name>Twin</display-name></channel>
${programme('one.test', NOW - 5 * H, NOW - 3 * H, 'Too old')}
${programme('one.test', NOW - 3 * H, NOW - H, 'Ended, inside the window')}
${programme('one.test', NOW - H, NOW + H, 'On air &amp; live')}
${programme('one.test', NOW + 47 * H, NOW + 49 * H, 'Starts inside the window')}
${programme('one.test', NOW + 49 * H, NOW + 50 * H, 'Too far')}
${programme('two.test', NOW, NOW + H, 'Two now')}
${programme('dup.a', NOW, NOW + H, 'Ambiguous')}
${programme('other.test', NOW, NOW + H, 'Unmatched')}
</tv>`;

const XZ_FEED_BASE64 =
  '/Td6WFoAAAFpIt42AgAhARwAAAAQz1jM4ADjAJtdAB4Py4cR2M5mkQ+DHsr9ezPUf+m32+OsNEUh/qeUnScz1zKRVmj6EhhiivPfn4Y0uppIY7Wbp34CvrKOae5QzoOA29FTWQtgxVOWflDa2qA83IuWH/wb+x5+hcD2VEH51CDhISislPR8VSCQW3+pjNFpXObfxqXbLyFClqRXONP7kuQzc7NhJpVsyOJcRbj1qQodQ8vT6aNeU8AAAAByOpRTAAGzAeQBAADuILQ6PjANiwIAAAAAAVla';

function channel(id: string, name: string, epgId?: string): Channel {
  const c: Channel = {
    key: `${SOURCE_ID}:live:${id}`,
    sourceId: SOURCE_ID,
    externalId: id,
    type: 'live',
    name,
    nameNorm: name.toLowerCase(),
    order: 0,
    streamPath: '',
  };
  if (epgId !== undefined) c.epgId = epgId;
  return c;
}

const source = (changes: Partial<Source> = {}): Source => ({
  id: SOURCE_ID,
  kind: 'm3u-url',
  name: 'List',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 4, movies: 0, series: 0 },
  epgUrls: [EPG_URL],
  ...changes,
});

const respond =
  (body: BodyInit, requested: string[] = []): FetchImpl =>
  (input) => {
    requested.push(input);
    return Promise.resolve(new Response(body, { status: 200 }));
  };

const gzip = (text: string) =>
  new Response(
    new Blob([text])
      .stream()
      .pipeThrough(
        new CompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
      ),
  ).arrayBuffer();

async function stored(): Promise<EpgProgram[]> {
  const db = await openDatabase();
  return db.epgPrograms.where('sourceId').equals(SOURCE_ID).sortBy('start');
}

beforeEach(async () => {
  const db = await openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
  await sourcesRepo.put(source());
  await db.channels.bulkPut([
    channel('1', 'Whatever', 'one.test'), // AC1: exact tvg-id
    channel('2', 'PT: Canal Dois HD'), // AC2: by normalized name
    channel('3', 'Twin'), // AC3: ambiguous → no EPG
    channel('4', 'No guide'),
  ]);
});

afterEach(async () => {
  await closeDatabase();
});

describe('importEpg', () => {
  it('stores only matched programmes inside −2 h…+48 h and records the coverage', async () => {
    const result = await importEpg({ sourceId: SOURCE_ID }, ctx, {
      fetchImpl: respond(FEED),
      now: () => NOW,
    });
    expect(result).toMatchObject({ status: 'ok', programmes: 4, channelsWithEpg: 2, channels: 4 });
    const rows = await stored();
    expect(rows.map((r) => [r.channelEpgId.split(':')[2], r.title])).toEqual([
      ['1', 'Ended, inside the window'],
      ['1', 'On air & live'],
      ['2', 'Two now'],
      ['1', 'Starts inside the window'],
    ]);
    expect((await sourcesRepo.get(SOURCE_ID))?.epgStatus).toMatchObject({
      status: 'ok',
      at: NOW,
      lastOkAt: NOW,
      channelsWithEpg: 2,
      channels: 4,
    });
    expect((await epgRepo.upcoming(`${SOURCE_ID}:live:1`, NOW)).map((p) => p.title)).toEqual([
      'On air & live',
      'Starts inside the window',
    ]);
  });

  it('decompresses gzip and xz bodies (sniffed, not by extension)', async () => {
    const gz = await importEpg({ sourceId: SOURCE_ID }, ctx, {
      fetchImpl: respond(await gzip(FEED)),
      now: () => NOW,
    });
    expect(gz).toMatchObject({ status: 'ok', programmes: 4 });

    await sourcesRepo.update(SOURCE_ID, {
      epgUrls: ['https://epg.example.test/guide.xml.xz'],
    });
    const db = await openDatabase();
    await db.channels.put(channel('5', 'XZ One'));
    const xz = await importEpg({ sourceId: SOURCE_ID, force: true }, ctx, {
      fetchImpl: respond(Uint8Array.from(atob(XZ_FEED_BASE64), (c) => c.charCodeAt(0))),
      now: () => Date.UTC(2026, 9, 30, 12),
    });
    expect(xz).toMatchObject({ status: 'ok', programmes: 1 });
    expect((await stored()).map((r) => r.title)).toEqual(['From xz & more']);
  });

  it('purges finished programmes on refresh and replaces the guide', async () => {
    const old: EpgProgram = {
      channelEpgId: 'other:live:9',
      sourceId: 'other',
      start: NOW - 30 * H,
      end: NOW - 20 * H,
      title: 'Long gone',
    };
    const db = await openDatabase();
    await db.epgPrograms.put(old);
    await importEpg({ sourceId: SOURCE_ID }, ctx, { fetchImpl: respond(FEED), now: () => NOW });
    // 12 h later the refresh is due; programmes that ended before the window are gone.
    const later = NOW + 12 * H;
    expect(isEpgDue((await sourcesRepo.get(SOURCE_ID)) as Source, later)).toBe(true);
    const result = await importEpg({ sourceId: SOURCE_ID }, ctx, {
      fetchImpl: respond(FEED),
      now: () => later,
    });
    expect(result.status).toBe('ok');
    expect(await db.epgPrograms.get(['other:live:9', old.start])).toBeUndefined();
    expect((await stored()).every((r) => r.end > later - 2 * H)).toBe(true);
  });

  it('keeps the previous guide on failure and records a code, never the URL', async () => {
    await importEpg({ sourceId: SOURCE_ID }, ctx, { fetchImpl: respond(FEED), now: () => NOW });
    const result = await importEpg({ sourceId: SOURCE_ID, force: true }, ctx, {
      fetchImpl: respond('<html>Not found</html>'),
      now: () => NOW + H,
    });
    expect(result).toMatchObject({ status: 'error', error: 'not-xmltv' });
    expect(await stored()).toHaveLength(4);
    const status = (await sourcesRepo.get(SOURCE_ID))?.epgStatus;
    expect(status).toEqual({ status: 'error', at: NOW + H, error: 'not-xmltv', lastOkAt: NOW });
  });

  it('downloads through the list data rewriter (personal proxy) and prefers the manual URL', async () => {
    await sourcesRepo.update(SOURCE_ID, { epgUrl: 'https://manual.example.test/epg.xml.gz' });
    const requested: string[] = [];
    await importEpg({ sourceId: SOURCE_ID }, ctx, {
      fetchImpl: respond(FEED, requested),
      now: () => NOW,
      rewriterFor: () =>
        Promise.resolve({
          rewrite: (url, purpose) =>
            `https://pc.example.test/v1/tok/${purpose}/${encodeURIComponent(url)}`,
        }),
    });
    expect(requested).toEqual([
      `https://pc.example.test/v1/tok/epg/${encodeURIComponent('https://manual.example.test/epg.xml.gz')}`,
    ]);
  });
});
