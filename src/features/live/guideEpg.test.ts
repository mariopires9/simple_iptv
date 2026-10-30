// EPG-04 — the guide's programme source: Xtream lists use the short-EPG service with a longer
// listing per channel; M3U lists read their stored guide over the whole window.
import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import { epgRepo, itemKey, sourcesRepo, wipeAll, type Channel, type Source } from '@/core/db';
import { m3uSource } from '@/ui/test-utils/sources';
import { createGuideEpgService, GUIDE_XTREAM_LIMIT } from './guideEpg';
import { guideWindow } from './guideLayout';

const HOUR = 3_600_000;

afterAll(async () => {
  await wipeAll();
});

describe('createGuideEpgService', () => {
  it('asks Xtream panels for GUIDE_XTREAM_LIMIT programmes per channel', async () => {
    const asked: string[] = [];
    const source: Source = {
      ...m3uSource('x1', 'Panel', 1),
      kind: 'xtream',
      serverUrl: 'https://panel.example.test',
      username: 'user',
      secretRef: 'ref',
    };
    const service = createGuideEpgService(source, guideWindow(Date.now()), {
      vault: { get: () => Promise.resolve('pw') },
      fetchImpl: (input) => {
        asked.push(String(input));
        return Promise.resolve(Response.json({ epg_listings: [] }));
      },
    });
    await service?.load({ key: 'x1:live:7', streamPath: '7' } as Channel);
    expect(asked).toHaveLength(1);
    expect(new URL(asked[0] ?? '').searchParams.get('limit')).toBe(String(GUIDE_XTREAM_LIMIT));
  });

  it('reads past and future programmes of an M3U list over the window', async () => {
    const now = Date.now();
    const span = guideWindow(now);
    const key = itemKey('m1', 'live', 'c1');
    await sourcesRepo.put({
      ...m3uSource('m1', 'List', 1),
      epgStatus: { status: 'ok', at: now, lastOkAt: now },
    });
    await epgRepo.replaceForExistingSource('m1', [
      { channelEpgId: key, sourceId: 'm1', start: now - 2 * HOUR, end: now - HOUR, title: 'Past' },
      { channelEpgId: key, sourceId: 'm1', start: now, end: now + HOUR, title: 'Now' },
      {
        channelEpgId: key,
        sourceId: 'm1',
        start: now + 30 * HOUR,
        end: now + 31 * HOUR,
        title: 'Later',
      },
      {
        channelEpgId: key,
        sourceId: 'm1',
        start: span.end + HOUR,
        end: span.end + 2 * HOUR,
        title: 'Beyond',
      },
    ]);
    const source = await sourcesRepo.get('m1');
    const service = source && createGuideEpgService(source, span);
    const channel = { key } as Channel;
    const programmes = await service?.load(channel);
    expect(programmes?.map((p) => p.title)).toEqual(['Past', 'Now', 'Later']);
    // Cached even though the first programme already ended.
    expect(service?.peek(channel)).toBe(programmes);
  });
});
