// Network sandbox for E2E (QA-02): the preview origin is served normally; the synthetic Xtream panel
// is answered by the QA-01 MSW handlers (shared with Vitest, QA-01 AC3); stream, segment and image
// requests on the synthetic hosts get the local test media from fixtures/streams; anything else is
// aborted and recorded, so a test can assert that nothing left the sandbox.
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Route } from '@playwright/test';
import { getResponse, type HttpHandler } from 'msw';
import { runnerImport } from 'vite';

type MswModule = typeof import('../../src/test/msw');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STREAMS = join(ROOT, 'fixtures/streams');

let mswModule: Promise<MswModule> | undefined;

/**
 * Loads `src/test/msw` through Vite's module runner: the handlers import JSON and `?raw` fixtures,
 * which only Vite (not Node or Playwright's loader) understands. One load per worker.
 */
export function loadMsw(): Promise<MswModule> {
  mswModule ??= runnerImport<MswModule>(join(ROOT, 'src/test/msw/index.ts'), {
    configFile: false,
    logLevel: 'silent',
  }).then((result) => result.module);
  return mswModule;
}

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt',
};

/** 1×1 transparent PNG for logos, posters and covers. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const CORS = { 'Access-Control-Allow-Origin': '*' };

/** Test media read once per worker (the same few files are served many times per test). */
const fileCache = new Map<string, Promise<Buffer>>();
function readFixture(file: string): Promise<Buffer> {
  let buffer = fileCache.get(file);
  if (!buffer) {
    buffer = readFile(file);
    fileCache.set(file, buffer);
  }
  return buffer;
}

/**
 * Maps a synthetic stream URL (Xtream `/live/<u>/<p>/<id>.<ext>`, or the M3U fixtures'
 * `/live/<id>.<ext>`) to a test file:
 * - `/live/<u>/<p>/<id>.m3u8` → HLS playlist; its relative segments (`/live/<u>/<p>/seg00.ts`)
 *   come from the same folder
 * - `/live/<u>/<p>/<id>.ts` → MPEG-TS H.264/AAC
 * - `/movie|series/<u>/<p>/<id>.<ext>` → progressive MP4 (whatever the extension)
 */
export function streamFileFor(pathname: string): string | undefined {
  const match = /^\/(live|movie|series)\/(?:[^/]+\/[^/]+\/)?([^/]+)$/.exec(pathname);
  if (!match) return undefined;
  const [, kind, file = ''] = match;
  if (kind !== 'live') return join(STREAMS, 'mp4/h264-aac.mp4');
  if (/^seg\d+\.ts$/.test(file)) return join(STREAMS, 'hls', file);
  if (file.endsWith('.m3u8')) return join(STREAMS, 'hls/index.m3u8');
  if (file.endsWith('.ts')) return join(STREAMS, 'ts/h264-aac.ts');
  return undefined;
}

/**
 * A panel request without its credentials: `player_api.php` → its `action` (`auth` when none),
 * plus the item id when there is one (e.g. `get_short_epg:1001`); other endpoints by path.
 */
export function panelCall(url: URL): string {
  if (!url.pathname.endsWith('/player_api.php')) return url.pathname;
  const action = url.searchParams.get('action') ?? 'auth';
  const params = url.searchParams;
  const id = params.get('stream_id') ?? params.get('vod_id') ?? params.get('series_id');
  return id === null ? action : `${action}:${id}`;
}

export interface NetworkSandbox {
  /** URLs that were blocked because they matched no allowed or mocked host. */
  readonly blocked: string[];
  /** Paths of the stream/segment requests served from fixtures/streams. */
  readonly streams: string[];
  /** Requests answered by the MSW panel handlers, as {@link panelCall} names them. */
  readonly panel: string[];
}

export interface SandboxOptions {
  /** Origin of `vite preview` (passes through untouched). */
  appOrigin: string;
}

/** Hosts of the QA-01 fixtures: the Xtream panel and the M3U fixtures' stream server. */
const MEDIA_HOSTS = ['panel.example.test', 'stream.example.test'];
const IMAGE_HOSTS = ['img.example.test'];

/** Installs the sandbox on a browser context (every page, worker and request of it). */
export async function installNetworkSandbox(
  context: BrowserContext,
  { appOrigin }: SandboxOptions,
): Promise<NetworkSandbox> {
  const msw = await loadMsw();
  // Xtream panel handlers for the synthetic base URL (variant A, valid account).
  const handlers: HttpHandler[] = msw.xtreamHandlers();
  const sandbox: NetworkSandbox = { blocked: [], streams: [], panel: [] };

  await context.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin === appOrigin) return route.fallback();
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.fallback();

    if (IMAGE_HOSTS.includes(url.hostname)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL, headers: CORS });
    }

    if (MEDIA_HOSTS.includes(url.hostname)) {
      const file = streamFileFor(url.pathname);
      if (file) {
        sandbox.streams.push(url.pathname);
        const body = await readFixture(file);
        return route.fulfill({
          status: 200,
          body,
          headers: {
            ...CORS,
            'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
          },
        });
      }
      const method = request.method();
      // GET/HEAD cannot carry a body; any other method forwards it so a handler can read it.
      const postData = method === 'GET' || method === 'HEAD' ? null : request.postDataBuffer();
      const requestBody = postData ? new Uint8Array(postData) : null;
      const mocked = await getResponse(
        handlers,
        new Request(request.url(), { method, headers: request.headers(), body: requestBody }),
      );
      if (mocked?.type === 'error') {
        // `HttpResponse.error()`: what a CORS or mixed-content block looks like to the app.
        sandbox.panel.push(panelCall(url));
        return route.abort('failed');
      }
      if (mocked) {
        sandbox.panel.push(panelCall(url));
        const headers: Record<string, string> = {};
        mocked.headers.forEach((value, key) => (headers[key] = value));
        return route.fulfill({
          status: mocked.status,
          headers,
          body: Buffer.from(await mocked.arrayBuffer()),
        });
      }
    }

    sandbox.blocked.push(request.url());
    return route.abort('blockedbyclient');
  });

  return sandbox;
}
