import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  XTREAM_ACTIONS,
  isXtreamAction,
  XTREAM_TEST_BASE_URL,
  xmltvFixtures,
  xtreamFixtures,
  xtreamHandlers,
  type XtreamVariant,
} from './index';
import { createMswServer } from './server';

const server = createMswServer(...xtreamHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const CREDS = 'username=jdoe&password=testpass';
const api = (query = '') => `${XTREAM_TEST_BASE_URL}/player_api.php?${CREDS}${query}`;
const getJson = async (url: string) => {
  const res = await fetch(url);
  expect(res.status).toBe(200);
  return (await res.json()) as unknown;
};

describe('createMswServer', () => {
  it('rejects requests no handler covers (onUnhandledFrame: error)', async () => {
    await expect(fetch('http://unmocked.example.test/x')).rejects.toThrow();
  });
});

describe('xtreamHandlers — auth (QA-01 AC4)', () => {
  it('serves auth-ok.json by default', async () => {
    expect(await getJson(api())).toEqual(xtreamFixtures.authOk);
  });

  it.each([
    ['ok-https', xtreamFixtures.serverInfoHttps],
    ['fail', xtreamFixtures.authFail],
    ['expired', xtreamFixtures.accountExpired],
    ['banned', xtreamFixtures.accountBanned],
  ] as const)('auth: %s serves the matching fixture', async (auth, fixture) => {
    server.use(...xtreamHandlers({ auth }));
    expect(await getJson(api())).toEqual(fixture);
  });

  it('wrong credentials behave like auth fail, also for actions', async () => {
    expect(
      await getJson(`${XTREAM_TEST_BASE_URL}/player_api.php?username=jdoe&password=nope`),
    ).toEqual(xtreamFixtures.authFail);
    expect(
      await getJson(
        `${XTREAM_TEST_BASE_URL}/player_api.php?username=x&password=y&action=get_live_streams`,
      ),
    ).toEqual(xtreamFixtures.authFail);
  });

  it('an expired account gets the expired JSON for actions and 403 for get.php/xmltv.php', async () => {
    server.use(...xtreamHandlers({ auth: 'expired' }));
    expect(await getJson(api('&action=get_live_categories'))).toEqual(
      xtreamFixtures.accountExpired,
    );
    expect((await fetch(`${XTREAM_TEST_BASE_URL}/get.php?${CREDS}&type=m3u_plus`)).status).toBe(
      403,
    );
    expect((await fetch(`${XTREAM_TEST_BASE_URL}/xmltv.php?${CREDS}`)).status).toBe(403);
  });

  it('bad credentials get 401 from get.php', async () => {
    expect((await fetch(`${XTREAM_TEST_BASE_URL}/get.php?username=jdoe&password=bad`)).status).toBe(
      401,
    );
  });

  it('honours a custom baseUrl and custom credentials', async () => {
    server.use(
      ...xtreamHandlers({
        baseUrl: 'https://other.example.test/panel/',
        credentials: { username: 'u', password: 'p' },
      }),
    );
    expect(
      await getJson('https://other.example.test/panel/player_api.php?username=u&password=p'),
    ).toEqual(xtreamFixtures.authOk);
  });
});

describe('xtreamHandlers — catalogue actions', () => {
  it.each(['A', 'B', 'C'] as const)(
    'variant %s serves every catalogue fixture',
    async (variant: XtreamVariant) => {
      server.use(...xtreamHandlers({ variant }));
      const v = xtreamFixtures.variants[variant];
      expect(await getJson(api('&action=get_live_categories'))).toEqual(v.liveCategories);
      expect(await getJson(api('&action=get_live_streams'))).toEqual(v.liveStreams);
      expect(await getJson(api('&action=get_vod_categories'))).toEqual(v.vodCategories);
      expect(await getJson(api('&action=get_vod_streams'))).toEqual(v.vodStreams);
      expect(await getJson(api('&action=get_series_categories'))).toEqual(v.seriesCategories);
      expect(await getJson(api('&action=get_series'))).toEqual(v.series);
    },
  );

  it.each(['A', 'B', 'C'] as const)(
    'variant %s filters get_live_streams by category_id',
    async (variant) => {
      server.use(...xtreamHandlers({ variant }));
      const streams = (await getJson(api('&action=get_live_streams&category_id=2'))) as Array<{
        category_id: unknown;
      }>;
      expect(streams.length).toBe(2);
      expect(streams.every((s) => String(s.category_id) === '2')).toBe(true);
      expect(await getJson(api('&action=get_live_streams&category_id=999'))).toEqual([]);
    },
  );

  it('variant B really has numbers as strings and missing fields; C has mixed category_id types', () => {
    const b = xtreamFixtures.variants.B.liveStreams;
    expect(b.every((s) => typeof s.stream_id === 'string')).toBe(true);
    expect(b.some((s) => !('epg_channel_id' in s))).toBe(true);
    const c = xtreamFixtures.variants.C.liveStreams.map((s) => typeof s.category_id);
    expect(new Set(c)).toEqual(new Set(['number', 'string']));
  });

  it('get_vod_info returns vod-info.json for its id and an empty shape otherwise', async () => {
    expect(await getJson(api('&action=get_vod_info&vod_id=2001'))).toEqual(xtreamFixtures.vodInfo);
    expect(await getJson(api('&action=get_vod_info&vod_id=9'))).toEqual({
      info: [],
      movie_data: [],
    });
  });

  it('get_series_info returns episodes as an object (3001) or as an array (3002)', async () => {
    const obj = (await getJson(api('&action=get_series_info&series_id=3001'))) as {
      episodes: unknown;
    };
    expect(obj).toEqual(xtreamFixtures.seriesInfoEpisodesObject);
    expect(Array.isArray(obj.episodes)).toBe(false);
    const arr = (await getJson(api('&action=get_series_info&series_id=3002'))) as {
      episodes: unknown;
    };
    expect(arr).toEqual(xtreamFixtures.seriesInfoEpisodesArray);
    expect(Array.isArray(arr.episodes)).toBe(true);
  });

  it('get_short_epg returns base64 UTF-8 listings and honours limit', async () => {
    const all = (await getJson(api('&action=get_short_epg&stream_id=1001'))) as {
      epg_listings: Array<{ title: string }>;
    };
    expect(all).toEqual(xtreamFixtures.shortEpg);
    const titles = all.epg_listings.map((l) =>
      new TextDecoder().decode(Uint8Array.from(atob(l.title), (c) => c.charCodeAt(0))),
    );
    expect(titles).toContain('Notícias da Manhã');
    expect(titles).toContain('Café com Ciência');
    const limited = (await getJson(api('&action=get_short_epg&stream_id=1001&limit=2'))) as {
      epg_listings: unknown[];
    };
    expect(limited.epg_listings).toHaveLength(2);
    expect(await getJson(api('&action=get_short_epg&stream_id=1003'))).toEqual({
      epg_listings: [],
    });
  });

  it('unknown actions answer an empty array', async () => {
    expect(await getJson(api('&action=get_something_else'))).toEqual([]);
  });

  it('get.php serves the M3U playlist (output=m3u8 rewrites .ts URLs)', async () => {
    const res = await fetch(`${XTREAM_TEST_BASE_URL}/get.php?${CREDS}&type=m3u_plus&output=ts`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('audio/x-mpegurl');
    const body = await res.text();
    expect(body).toBe(xtreamFixtures.m3uPlus);
    expect(body.startsWith('#EXTM3U')).toBe(true);
    const hls = await (
      await fetch(`${XTREAM_TEST_BASE_URL}/get.php?${CREDS}&type=m3u_plus&output=m3u8`)
    ).text();
    expect(hls).toContain('/live/jdoe/testpass/1001.m3u8');
    expect(hls).not.toMatch(/\/live\/.*\.ts$/m);
  });

  it('xmltv.php serves the XMLTV guide', async () => {
    const res = await fetch(`${XTREAM_TEST_BASE_URL}/xmltv.php?${CREDS}`);
    expect(res.headers.get('content-type')).toContain('application/xml');
    expect(await res.text()).toBe(xmltvFixtures.small);
  });
});

describe('xtreamHandlers — CORS and delay', () => {
  it('adds CORS headers and answers preflight by default', async () => {
    const res = await fetch(api());
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const pre = await fetch(api(), { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
  });

  it('cors: false omits CORS headers', async () => {
    server.use(...xtreamHandlers({ cors: false }));
    const res = await fetch(api());
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('delayMs delays the response', async () => {
    server.use(...xtreamHandlers({ delayMs: 150 }));
    const t0 = performance.now();
    await fetch(api());
    expect(performance.now() - t0).toBeGreaterThanOrEqual(140);
  });
});

describe('xtreamHandlers — error modes', () => {
  it.each([
    ['http-500', 500],
    ['http-401', 401],
    ['http-403', 403],
    ['http-404', 404],
  ] as const)('%s answers status %d on every endpoint', async (error, status) => {
    server.use(...xtreamHandlers({ error }));
    expect((await fetch(api())).status).toBe(status);
    expect((await fetch(api('&action=get_vod_streams'))).status).toBe(status);
    expect((await fetch(`${XTREAM_TEST_BASE_URL}/get.php?${CREDS}`)).status).toBe(status);
    expect((await fetch(`${XTREAM_TEST_BASE_URL}/xmltv.php?${CREDS}`)).status).toBe(status);
  });

  it('html answers 200 text/html that is not JSON', async () => {
    server.use(...xtreamHandlers({ error: 'html' }));
    const res = await fetch(api());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    await expect(res.json()).rejects.toThrow(SyntaxError);
  });

  it('invalid-json answers 200 application/json with an unparsable body', async () => {
    server.use(...xtreamHandlers({ error: 'invalid-json' }));
    const res = await fetch(api('&action=get_live_streams'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).rejects.toThrow(SyntaxError);
  });

  it('network rejects with a TypeError (simulated CORS/mixed-content block)', async () => {
    server.use(...xtreamHandlers({ error: 'network' }));
    await expect(fetch(api())).rejects.toThrow(TypeError);
  });

  it('timeout never resolves until the request is aborted', async () => {
    server.use(...xtreamHandlers({ error: 'timeout' }));
    await expect(fetch(api(), { signal: AbortSignal.timeout(100) })).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('errorOn limits the error to the listed endpoints', async () => {
    server.use(...xtreamHandlers({ error: 'http-500', errorOn: ['get_short_epg', 'xmltv.php'] }));
    expect((await fetch(api())).status).toBe(200);
    expect((await fetch(api('&action=get_live_streams'))).status).toBe(200);
    expect((await fetch(api('&action=get_short_epg&stream_id=1001'))).status).toBe(500);
    expect((await fetch(`${XTREAM_TEST_BASE_URL}/xmltv.php?${CREDS}`)).status).toBe(500);
  });

  it('covers every action listed in RESEARCH §7', () => {
    expect([...XTREAM_ACTIONS].sort()).toEqual(
      [
        'get_live_categories',
        'get_live_streams',
        'get_vod_categories',
        'get_vod_streams',
        'get_vod_info',
        'get_series_categories',
        'get_series',
        'get_series_info',
        'get_short_epg',
      ].sort(),
    );
  });
});

describe('xtreamHandlers — review findings', () => {
  // Finding 7: preflights are scoped to the panel endpoints, even with baseUrl '*'.
  it("baseUrl '*' answers preflights for panel paths only", async () => {
    server.resetHandlers(...xtreamHandlers({ baseUrl: '*' }));
    for (const path of ['player_api.php', 'get.php', 'xmltv.php']) {
      const res = await fetch(`https://any.example.test/${path}`, { method: 'OPTIONS' });
      expect(res.status).toBe(204);
    }
    // onUnhandledFrame: 'error' → an unrelated host's preflight is not swallowed.
    await expect(
      fetch('https://unrelated.example.test/api/thing', { method: 'OPTIONS' }),
    ).rejects.toThrow();
  });

  // Finding 8: unknown actions have their own errorOn bucket, not 'auth'.
  it("errorOn: ['auth'] does not affect unknown actions", async () => {
    server.use(...xtreamHandlers({ error: 'http-500', errorOn: ['auth'] }));
    expect((await fetch(api())).status).toBe(500);
    expect(await getJson(api('&action=get_something_else'))).toEqual([]);
  });

  it("errorOn: ['unknown-action'] targets unknown actions only", async () => {
    server.use(...xtreamHandlers({ error: 'http-500', errorOn: ['unknown-action'] }));
    expect((await fetch(api('&action=get_something_else'))).status).toBe(500);
    expect((await fetch(api())).status).toBe(200);
    expect((await fetch(api('&action=get_live_streams'))).status).toBe(200);
  });

  it('error without errorOn also applies to unknown actions', async () => {
    server.use(...xtreamHandlers({ error: 'http-403' }));
    expect((await fetch(api('&action=get_something_else'))).status).toBe(403);
  });

  it('unknown actions with bad credentials get the auth-fail JSON', async () => {
    expect(
      await getJson(`${XTREAM_TEST_BASE_URL}/player_api.php?username=x&password=y&action=nope`),
    ).toEqual(xtreamFixtures.authFail);
  });

  // Finding 9: type guard instead of casts.
  it('isXtreamAction narrows known actions only', () => {
    expect(XTREAM_ACTIONS.every((a) => isXtreamAction(a))).toBe(true);
    expect(isXtreamAction('get_something_else')).toBe(false);
    expect(isXtreamAction(null)).toBe(false);
  });
});
