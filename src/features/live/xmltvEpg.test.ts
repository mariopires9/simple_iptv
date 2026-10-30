// EPG-02: now/next of M3U lists from the stored XMLTV guide, behind the EPG-01 service interface.
import { describe, expect, it, vi } from 'vitest';
import type { Channel, EpgProgram, Source } from '@/core/db';
import { createXmltvEpgService } from './xmltvEpg';

const NOW = Date.UTC(2026, 9, 30, 12);
const H = 60 * 60 * 1000;
const channel = { key: 's:live:1', name: 'One' } as Channel;
const m3u = (changes: Partial<Source> = {}) =>
  ({ id: 's', kind: 'm3u-url', epgUrls: ['https://epg.example.test/g.xml'], ...changes }) as Source;
const row = (start: number, end: number, title: string): EpgProgram => ({
  channelEpgId: channel.key,
  sourceId: 's',
  start,
  end,
  title,
});

describe('createXmltvEpgService', () => {
  it('is only created for M3U lists with a guide', () => {
    expect(createXmltvEpgService({ id: 'x', kind: 'xtream' } as Source)).toBeUndefined();
    expect(createXmltvEpgService(m3u({ epgUrls: [] }))).toBeUndefined();
  });

  it('serves the stored programmes and refreshes after a due import stores a new guide', async () => {
    let finishImport: (stored: boolean) => void = () => {};
    const importGuide = vi.fn(() => new Promise<boolean>((r) => (finishImport = r)));
    const upcoming = vi
      .fn<(key: string, now: number) => Promise<EpgProgram[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([row(NOW - H, NOW + H, 'On air'), row(NOW + H, NOW + 2 * H, 'Next')]);
    const epg = createXmltvEpgService(m3u(), { now: () => NOW, upcoming, importGuide });
    expect(importGuide).toHaveBeenCalledWith('s');

    expect(await epg?.load(channel)).toEqual([]);
    const listener = vi.fn();
    epg?.subscribe(listener);
    finishImport(true);
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    expect(epg?.peek(channel)).toBeUndefined(); // cache dropped
    const programmes = await epg?.load(channel);
    expect(programmes?.map((p) => p.title)).toEqual(['On air', 'Next']);
    expect(epg?.peek(channel)).toBe(programmes);
  });

  it('does not import a fresh guide', () => {
    const importGuide = vi.fn(() => Promise.resolve(false));
    createXmltvEpgService(m3u({ epgStatus: { status: 'ok', at: NOW - H, lastOkAt: NOW - H } }), {
      now: () => NOW,
      importGuide,
    });
    expect(importGuide).not.toHaveBeenCalled();
  });
});
