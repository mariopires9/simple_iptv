#!/usr/bin/env node
// Local test stream server for player tests (QA-01). Zero dependencies (node:http).
//
//   node scripts/test-stream-server.mjs [--port 8090] [--host 127.0.0.1] [--cors on|off]
//                                       [--root fixtures/streams] [--redirect-to http://127.0.0.1:8091]
//                                       [--slow-bps 65536]
//
// Serves static files with correct MIME types, HEAD and single-range `Range: bytes=` support.
// Per-request behaviour is selected with path prefixes, which can be stacked
// (e.g. /cors/slow/hls/index.m3u8):
//   /slow/...      throttle the body to --slow-bps bytes per second
//   /error500/...  respond 500
//   /auth401/...   respond 401 (no WWW-Authenticate, so browsers do not prompt)
//   /redirect/...  302 to `${--redirect-to or this server}/<rest of path>`
//   /cors/...      force CORS headers on for this request
//   /nocors/...    force CORS headers off for this request
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('../fixtures/streams/', import.meta.url));

export const MIME_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m3u': 'audio/x-mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.vtt': 'text/vtt; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.gz': 'application/gzip',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const PREFIXES = new Set(['slow', 'error500', 'auth401', 'redirect', 'cors', 'nocors']);

/**
 * Parses a `Range` header against a file size, following RFC 9110 §14.
 * - `null`: no header, unknown unit, malformed syntax or multiple ranges → ignore, serve 200
 * - `'unsatisfiable'`: a syntactically valid single `bytes=` range outside the file → 416
 * @returns {{start: number, end: number} | 'unsatisfiable' | null}
 */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null; // "bytes=-" is not a valid range-spec
  if (a === '') {
    const suffix = Number(b);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(a);
  if (b !== '' && Number(b) < start) return null; // last-pos < first-pos: invalid, ignore
  if (start >= size) return 'unsatisfiable';
  return { start, end: b === '' ? size - 1 : Math.min(Number(b), size - 1) };
}

/**
 * Splits a raw request target into decoded-later path segments and the query string,
 * without URL resolution (so `//host/path` is a path, not an authority).
 */
export function splitRequestTarget(target = '/') {
  const q = target.indexOf('?');
  const path = q === -1 ? target : target.slice(0, q);
  const search = q === -1 ? '' : target.slice(q);
  return { segments: path.split('/').filter(Boolean), search };
}

/**
 * Opens a read stream and waits until the file is open, so a file that disappeared after
 * `stat` can still be answered with a 500 instead of crashing the server.
 */
function openStream(filePath, options) {
  const stream = createReadStream(filePath, options);
  return new Promise((resolveOpen, rejectOpen) => {
    const onError = (error) => rejectOpen(error);
    stream.once('error', onError);
    stream.once('ready', () => {
      stream.off('error', onError);
      resolveOpen(stream);
    });
  });
}

/**
 * Starts the server. Resolves once it is listening.
 * @param {{port?: number, host?: string, cors?: boolean, root?: string, redirectTo?: string, slowBps?: number}} [options]
 */
export function startTestStreamServer(options = {}) {
  const {
    port = 0,
    host = '127.0.0.1',
    cors = true,
    root = DEFAULT_ROOT,
    slowBps = 64 * 1024,
  } = options;
  const rootDir = resolve(root);
  const redirectBase = (options.redirectTo ?? '').replace(/\/+$/, '');

  const server = createServer(async (req, res) => {
    const { segments, search } = splitRequestTarget(req.url);
    const modes = new Set();
    while (segments.length > 0 && PREFIXES.has(segments[0])) modes.add(segments.shift());

    const corsOn = modes.has('cors') ? true : modes.has('nocors') ? false : cors;
    if (corsOn) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
      res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range, Accept-Ranges',
      );
    }
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') {
      res.writeHead(corsOn ? 204 : 405).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' }).end();
      return;
    }
    // Redirect first: the remaining modes are carried over to the target URL.
    if (modes.has('redirect')) {
      const remaining = [...modes]
        .filter((m) => m !== 'redirect')
        .map((m) => `/${m}`)
        .join('');
      const rest = '/' + segments.join('/') + search;
      res.writeHead(302, { Location: `${redirectBase}${remaining}${rest}` }).end();
      return;
    }
    if (modes.has('error500')) {
      res
        .writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('Internal Server Error (test mode)');
      return;
    }
    if (modes.has('auth401')) {
      res
        .writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('Unauthorized (test mode)');
      return;
    }

    let filePath;
    try {
      filePath = resolve(rootDir, ...segments.map((s) => decodeURIComponent(s)));
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (filePath !== rootDir && !filePath.startsWith(rootDir + sep)) {
      res.writeHead(403).end();
      return;
    }
    let info;
    try {
      info = await stat(filePath);
    } catch {
      info = null;
    }
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }

    const size = info.size;
    const headers = {
      'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    };
    const range = parseRange(req.headers.range, size);
    if (range === 'unsatisfiable') {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    const length = size === 0 ? 0 : end - start + 1;
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    headers['Content-Length'] = String(length);
    if (req.method === 'HEAD' || length === 0) {
      res.writeHead(range ? 206 : 200, headers).end();
      return;
    }

    const slow = modes.has('slow');
    let stream;
    try {
      stream = await openStream(filePath, {
        start,
        end,
        ...(slow ? { highWaterMark: Math.max(1, Math.floor(slowBps / 10)) } : {}),
      });
    } catch {
      // The file vanished (or became unreadable) between stat and open.
      if (!res.headersSent) {
        res
          .writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end('Read error (test server)');
      } else res.destroy();
      return;
    }
    // Late read errors: the status line is already out, so abort the response.
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    res.writeHead(range ? 206 : 200, headers);

    if (!slow) {
      stream.pipe(res);
      return;
    }
    // Throttle: one chunk of slowBps/10 bytes every 100 ms.
    try {
      for await (const chunk of stream) {
        if (res.destroyed) return;
        res.write(chunk);
        await sleep(100);
      }
      res.end();
    } catch {
      res.destroy();
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      // Keep the process alive on runtime server errors (e.g. clientError bursts); just log them.
      server.on('error', (error) => {
        process.stderr.write(`test-stream-server error: ${error?.message ?? error}\n`);
      });
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolvePromise({
        server,
        port: actualPort,
        url: `http://${host}:${actualPort}`,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections();
            server.close(() => r(undefined));
          }),
      });
    });
  });
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case '--port':
        opts.port = Number(value);
        i++;
        break;
      case '--host':
        opts.host = value;
        i++;
        break;
      case '--cors':
        if (value !== 'on' && value !== 'off') throw new Error('--cors must be "on" or "off"');
        opts.cors = value === 'on';
        i++;
        break;
      case '--root':
        opts.root = value;
        i++;
        break;
      case '--redirect-to':
        opts.redirectTo = value;
        i++;
        break;
      case '--slow-bps':
        opts.slowBps = Number(value);
        i++;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const opts = { port: 8090, ...parseArgs(process.argv.slice(2)) };
  const { url } = await startTestStreamServer(opts);
  process.stdout.write(
    `test stream server on ${url} (cors ${opts.cors === false ? 'off' : 'on'})\n`,
  );
}
