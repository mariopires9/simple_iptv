// EPG-01: `get_short_epg` parsing — base64 UTF-8 titles, timestamps, tolerance item by item.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { XTREAM_TEST_BASE_URL, xtreamFixtures, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { createXtreamClient } from './client';
import { decodeBase64Utf8, fetchShortEpg, parseShortEpg } from './shortEpg';

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe('decodeBase64Utf8', () => {
  it('decodes base64 as UTF-8 (accents, symbols, CJK)', () => {
    expect(decodeBase64Utf8('Tm90w61jaWFzIGRhIE1hbmjDow==')).toBe('Notícias da Manhã');
    expect(decodeBase64Utf8(b64('Café — 日本語'))).toBe('Café — 日本語');
  });

  it('returns plain text unchanged (panels that do not encode)', () => {
    expect(decodeBase64Utf8('Jornal da Noite')).toBe('Jornal da Noite');
    expect(decodeBase64Utf8('')).toBe('');
  });

  it('returns the raw value when it decodes to control characters (plain text that looks like base64)', () => {
    // "AAAA" → three NUL bytes; "Film" → 0x16 0x29 0x66.
    expect(decodeBase64Utf8('AAAA')).toBe('AAAA');
    expect(decodeBase64Utf8('Film')).toBe('Film');
    expect(decodeBase64Utf8('ABCD')).toBe('ABCD');
    // Tab, line feed and carriage return are text, not control noise.
    expect(decodeBase64Utf8(b64('Line 1\nLine 2\tend\r'))).toBe('Line 1\nLine 2\tend\r');
  });

  it('returns the raw value when the bytes are not valid UTF-8', () => {
    // "/w==" is the single byte 0xFF.
    expect(decodeBase64Utf8('/w==')).toBe('/w==');
  });
});

describe('parseShortEpg', () => {
  it('reads the fixture: decoded titles/descriptions and timestamps in ms, sorted', () => {
    const programmes = parseShortEpg(xtreamFixtures.shortEpg);
    expect(programmes).toHaveLength(4);
    expect(programmes[0]).toEqual({
      title: 'Morning News',
      description: 'Headlines and weather. Synthetic data.',
      start: 1767268800_000,
      end: 1767272400_000,
    });
    expect(programmes[1]?.title).toBe('Notícias da Manhã');
    expect(programmes[2]?.title).toBe('Café com Ciência');
    expect(programmes.map((p) => p.start)).toEqual([...programmes.map((p) => p.start)].sort());
  });

  it('drops unusable listings one by one and keeps the rest', () => {
    const good = { title: b64('Good'), start_timestamp: '1000', stop_timestamp: 2000 };
    const programmes = parseShortEpg({
      epg_listings: [
        null,
        'x',
        { title: b64('No times') },
        { title: b64('Bad range'), start_timestamp: 2000, stop_timestamp: 1000 },
        { title: '', start_timestamp: 1, stop_timestamp: 2 },
        { title: '\u0007\u0001', start_timestamp: 1, stop_timestamp: 2 },
        { ...good, description: 42 },
      ],
    });
    expect(programmes).toEqual([
      { title: 'Good', description: '42', start: 1_000_000, end: 2_000_000 },
    ]);
  });

  it('plain encoding never decodes (a panel that sends plain text)', () => {
    const programmes = parseShortEpg(
      [{ title: 'News', description: 'AAAA', start_timestamp: 1, stop_timestamp: 2 }],
      'plain',
    );
    expect(programmes[0]).toMatchObject({ title: 'News', description: 'AAAA' });
    // With the default (base64), a plain title that looks like base64 but is not text survives.
    expect(
      parseShortEpg([{ title: 'AAAA', start_timestamp: 1, stop_timestamp: 2 }])[0]?.title,
    ).toBe('AAAA');
  });

  it('sorts by start time and accepts a bare array', () => {
    const programmes = parseShortEpg([
      { title: 'B', start_timestamp: 3000, stop_timestamp: 4000 },
      { title: 'A', start_timestamp: 1000, stop_timestamp: 2000 },
    ]);
    expect(programmes.map((p) => p.title)).toEqual(['A', 'B']);
  });

  it.each([undefined, null, 'html', 42, {}, { epg_listings: 'nope' }, { epg_listings: [] }])(
    'yields [] for %j',
    (body) => {
      expect(parseShortEpg(body)).toEqual([]);
    },
  );
});

describe('fetchShortEpg (MSW)', () => {
  const server = createMswServer(...xtreamHandlers());
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  const client = () =>
    createXtreamClient({ baseUrl: XTREAM_TEST_BASE_URL, username: 'jdoe', password: 'testpass' });

  it('asks for stream_id and limit and decodes the answer', async () => {
    const programmes = await fetchShortEpg(client(), '1001', 2);
    expect(programmes.map((p) => p.title)).toEqual(['Morning News', 'Notícias da Manhã']);
  });

  it('a stream without EPG yields []', async () => {
    expect(await fetchShortEpg(client(), '42', 2)).toEqual([]);
  });
});
