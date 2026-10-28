// MSW request handlers for a synthetic Xtream Codes panel (QA-01, docs/RESEARCH.md §7).
// Browser-safe (no `msw/node`): reusable by Vitest (via createMswServer) and by Playwright
// (via `setupWorker` from `msw/browser`).
import { delay, http, HttpResponse, type HttpHandler } from 'msw';
import {
  XTREAM_TEST_BASE_URL,
  XTREAM_TEST_CREDENTIALS,
  xmltvFixtures,
  xtreamFixtures,
  type XtreamVariant,
} from './fixtures';

/**
 * - `ok`: auth-ok.json (no `https_port`)
 * - `ok-https`: server-info-https.json (`https_port` set)
 * - `fail`: auth-fail.json (`auth: 0`); also used whenever the request credentials are wrong
 * - `expired` / `banned`: account-expired.json / account-banned.json
 */
export type XtreamAuthMode = 'ok' | 'ok-https' | 'fail' | 'expired' | 'banned';

/**
 * - `timeout`: the response never resolves (abort it with an AbortSignal)
 * - `http-500` / `http-401` / `http-403` / `http-404`: empty-ish body with that status
 * - `html`: 200 with an HTML page (e.g. a captive portal or panel landing page)
 * - `invalid-json`: 200 `application/json` with a truncated JSON body
 * - `network`: network error (`TypeError: Failed to fetch`), i.e. what a CORS block or
 *   mixed-content block looks like to the app
 */
export type XtreamErrorMode =
  | 'timeout'
  | 'http-500'
  | 'http-401'
  | 'http-403'
  | 'http-404'
  | 'html'
  | 'invalid-json'
  | 'network';

export const XTREAM_ACTIONS = [
  'get_live_categories',
  'get_live_streams',
  'get_vod_categories',
  'get_vod_streams',
  'get_vod_info',
  'get_series_categories',
  'get_series',
  'get_series_info',
  'get_short_epg',
] as const;
export type XtreamAction = (typeof XTREAM_ACTIONS)[number];

/** `auth` = `player_api.php` without `action`. */
export type XtreamEndpoint = 'auth' | XtreamAction | 'get.php' | 'xmltv.php';

export interface XtreamHandlerOptions {
  /** Panel origin (+ optional path prefix). Default `http://panel.example.test:8080`. `'*'` matches any origin. */
  baseUrl?: string;
  /** Catalogue shape: A = numbers as numbers, B = numbers as strings/nulls/missing fields, C = odd shapes. Default `A`. */
  variant?: XtreamVariant;
  /** Account state. Default `ok`. */
  auth?: XtreamAuthMode;
  /** Delay before every response, in ms. Default 0. */
  delayMs?: number;
  /**
   * Add `Access-Control-Allow-Origin: *` (and answer preflights). Default `true`.
   * Note: browsers do not enforce CORS on responses synthesised by the MSW service worker, so
   * `cors: false` only removes the headers; use `error: 'network'` to simulate a CORS block.
   */
  cors?: boolean;
  /** Error to return instead of the fixture. */
  error?: XtreamErrorMode;
  /** Endpoints the `error` applies to. Default: all. */
  errorOn?: readonly XtreamEndpoint[];
  /** Credentials the fake panel accepts. Default `jdoe` / `testpass`. */
  credentials?: { username: string; password: string };
}

type Json = Record<string, unknown> | readonly unknown[];

const HTML_PAGE =
  '<!DOCTYPE html><html><head><title>Panel</title></head><body><h1>Welcome</h1></body></html>';
const INVALID_JSON = '{"user_info":{"auth":1,"status":"Active"';

const EMPTY_VOD_INFO = { info: [], movie_data: [] };
const EMPTY_SERIES_INFO = { seasons: [], info: [], episodes: [] };

function authBody(mode: XtreamAuthMode): Json {
  switch (mode) {
    case 'ok':
      return xtreamFixtures.authOk;
    case 'ok-https':
      return xtreamFixtures.serverInfoHttps;
    case 'fail':
      return xtreamFixtures.authFail;
    case 'expired':
      return xtreamFixtures.accountExpired;
    case 'banned':
      return xtreamFixtures.accountBanned;
  }
}

function filterByCategory(list: readonly unknown[], categoryId: string | null): readonly unknown[] {
  if (categoryId === null) return list;
  return list.filter(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      String((item as { category_id?: unknown }).category_id) === categoryId,
  );
}

/**
 * Handlers for `player_api.php` (auth + every action in RESEARCH §7), `get.php` (M3U) and
 * `xmltv.php`.
 *
 * Auth semantics: wrong credentials behave like `auth: 'fail'`. When the account is not usable,
 * `player_api.php` returns the matching auth JSON for every action (as many panels do) while
 * `get.php`/`xmltv.php` answer 401 (`fail`) or 403 (`expired`/`banned`).
 */
export function xtreamHandlers(options: XtreamHandlerOptions = {}): HttpHandler[] {
  const {
    baseUrl = XTREAM_TEST_BASE_URL,
    variant = 'A',
    auth = 'ok',
    delayMs = 0,
    cors = true,
    error,
    errorOn,
    credentials = XTREAM_TEST_CREDENTIALS,
  } = options;
  const base = baseUrl === '*' ? '*' : baseUrl.replace(/\/+$/, '');
  const catalogue = xtreamFixtures.variants[variant];
  const corsHeaders: Record<string, string> = cors
    ? {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      }
    : {};

  const json = (body: Json, status = 200) =>
    HttpResponse.json(body as Record<string, unknown>, { status, headers: corsHeaders });
  const text = (body: string, contentType: string, status = 200) =>
    new HttpResponse(body, { status, headers: { ...corsHeaders, 'Content-Type': contentType } });

  /** Applies delay and error mode. Returns a Response to short-circuit, or undefined. */
  async function prelude(endpoint: XtreamEndpoint): Promise<Response | undefined> {
    if (delayMs > 0) await delay(delayMs);
    if (!error || (errorOn && !errorOn.includes(endpoint))) return undefined;
    switch (error) {
      case 'timeout':
        await delay('infinite');
        return undefined;
      case 'http-500':
        return text('Internal Server Error', 'text/plain', 500);
      case 'http-401':
        return text('Unauthorized', 'text/plain', 401);
      case 'http-403':
        return text('Forbidden', 'text/plain', 403);
      case 'http-404':
        return text('Not Found', 'text/plain', 404);
      case 'html':
        return text(HTML_PAGE, 'text/html; charset=utf-8');
      case 'invalid-json':
        return text(INVALID_JSON, 'application/json');
      case 'network':
        return HttpResponse.error();
    }
  }

  function effectiveAuth(url: URL): XtreamAuthMode {
    const ok =
      url.searchParams.get('username') === credentials.username &&
      url.searchParams.get('password') === credentials.password;
    return ok ? auth : 'fail';
  }
  const usable = (mode: XtreamAuthMode) => mode === 'ok' || mode === 'ok-https';

  function action(name: XtreamAction, params: URLSearchParams): Json {
    switch (name) {
      case 'get_live_categories':
        return catalogue.liveCategories;
      case 'get_live_streams':
        return filterByCategory(catalogue.liveStreams, params.get('category_id'));
      case 'get_vod_categories':
        return catalogue.vodCategories;
      case 'get_vod_streams':
        return filterByCategory(catalogue.vodStreams, params.get('category_id'));
      case 'get_vod_info':
        return params.get('vod_id') === String(xtreamFixtures.vodInfo.movie_data.stream_id)
          ? xtreamFixtures.vodInfo
          : EMPTY_VOD_INFO;
      case 'get_series_categories':
        return catalogue.seriesCategories;
      case 'get_series':
        return filterByCategory(catalogue.series, params.get('category_id'));
      case 'get_series_info':
        // 3001 → episodes keyed by season (object); 3002 → episodes as array of seasons.
        if (params.get('series_id') === '3001') return xtreamFixtures.seriesInfoEpisodesObject;
        if (params.get('series_id') === '3002') return xtreamFixtures.seriesInfoEpisodesArray;
        return EMPTY_SERIES_INFO;
      case 'get_short_epg': {
        if (params.get('stream_id') !== '1001') return { epg_listings: [] };
        const limit = Number(params.get('limit') ?? '');
        const listings = xtreamFixtures.shortEpg.epg_listings;
        return {
          epg_listings: Number.isInteger(limit) && limit > 0 ? listings.slice(0, limit) : listings,
        };
      }
    }
  }

  const handlers: HttpHandler[] = [
    http.get(`${base}/player_api.php`, async ({ request }) => {
      const url = new URL(request.url);
      const name = url.searchParams.get('action');
      const endpoint: XtreamEndpoint | undefined =
        name === null
          ? 'auth'
          : (XTREAM_ACTIONS as readonly string[]).includes(name)
            ? (name as XtreamAction)
            : undefined;
      const early = await prelude(endpoint ?? 'auth');
      if (early) return early;
      const mode = effectiveAuth(url);
      if (name === null || !usable(mode)) return json(authBody(mode));
      // Unknown actions: panels typically answer an empty array.
      if (endpoint === undefined || endpoint === 'auth') return json([]);
      return json(action(endpoint as XtreamAction, url.searchParams));
    }),

    http.get(`${base}/get.php`, async ({ request }) => {
      const early = await prelude('get.php');
      if (early) return early;
      const url = new URL(request.url);
      const mode = effectiveAuth(url);
      if (!usable(mode)) return text('', 'text/plain', mode === 'fail' ? 401 : 403);
      const body =
        url.searchParams.get('output') === 'm3u8'
          ? xtreamFixtures.m3uPlus.replace(/\.ts$/gm, '.m3u8')
          : xtreamFixtures.m3uPlus;
      return text(body, 'audio/x-mpegurl; charset=utf-8');
    }),

    http.get(`${base}/xmltv.php`, async ({ request }) => {
      const early = await prelude('xmltv.php');
      if (early) return early;
      const mode = effectiveAuth(new URL(request.url));
      if (!usable(mode)) return text('', 'text/plain', mode === 'fail' ? 401 : 403);
      return text(xmltvFixtures.small, 'application/xml; charset=utf-8');
    }),
  ];

  if (cors) {
    handlers.push(
      http.options(
        `${base}/*`,
        () => new HttpResponse(null, { status: 204, headers: corsHeaders }),
      ),
    );
  }
  return handlers;
}
