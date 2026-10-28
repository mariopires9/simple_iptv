import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLogBuffer, clearSecrets, getLogEntries, registerSecret } from '@/core/log';
import { NetError } from './errors';
import {
  DEFAULT_TIMEOUT_MS,
  fetchJson,
  fetchText,
  identityRewriter,
  type FetchImpl,
  type UrlRewriter,
} from './http';

// Fictitious host and credentials only (CLAUDE.md).
const HOST = 'panel.example.test';
const USER = 'jdoe';
const PASS = 'testpass';
const HTTP_URL = `http://${HOST}:8080/player_api.php?username=${USER}&password=${PASS}`;
const HTTPS_URL = `https://${HOST}:8443/player_api.php?username=${USER}&password=${PASS}`;

const respond =
  (body: string, init: ResponseInit = {}): FetchImpl =>
  () =>
    Promise.resolve(new Response(body, init));
const throwing =
  (error: unknown): FetchImpl =>
  () =>
    Promise.reject(error);
/** Never settles unless its signal aborts, like a real fetch. */
const hanging: FetchImpl = (_url, init) =>
  new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSecrets();
  clearLogBuffer();
});

async function failure(promise: Promise<unknown>): Promise<NetError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(NetError);
    return error as NetError;
  }
  throw new Error('expected a NetError');
}

describe('fetchJson — success', () => {
  it('parses JSON and sends privacy-preserving request options', async () => {
    const fetchImpl = vi.fn<FetchImpl>(
      respond('{"a":1}', { headers: { 'content-type': 'application/json' } }),
    );
    await expect(fetchJson(HTTP_URL, { fetchImpl })).resolves.toEqual({ a: 1 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(HTTP_URL);
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not force no-store for non-API purposes', async () => {
    const fetchImpl = vi.fn<FetchImpl>(respond('x'));
    await expect(fetchText(HTTP_URL, { fetchImpl, purpose: 'playlist' })).resolves.toBe('x');
    expect(fetchImpl.mock.calls[0]![1].cache).toBeUndefined();
  });

  it('applies the URL rewriter with the purpose', async () => {
    const rewriter: UrlRewriter = {
      rewrite: vi.fn((url: string) => `https://proxy.example.test/?u=${encodeURIComponent(url)}`),
    };
    const fetchImpl = vi.fn<FetchImpl>(respond('[]'));
    await fetchJson(HTTP_URL, { fetchImpl, rewriter, purpose: 'epg' });
    expect(rewriter.rewrite).toHaveBeenCalledWith(HTTP_URL, 'epg');
    expect(fetchImpl.mock.calls[0]![0]).toMatch(/^https:\/\/proxy\.example\.test\//);
  });

  it('identity rewriter returns the URL unchanged', () => {
    expect(identityRewriter.rewrite(HTTP_URL, 'api')).toBe(HTTP_URL);
  });

  it('uses the global fetch by default', async () => {
    const stub = vi.fn<FetchImpl>(respond('{"ok":true}'));
    vi.stubGlobal('fetch', stub);
    await expect(fetchJson(HTTP_URL)).resolves.toEqual({ ok: true });
    expect(stub).toHaveBeenCalledOnce();
  });
});

describe('fetchJson — HTTP and parse errors', () => {
  it.each([401, 403])('HTTP %i → auth', async (status) => {
    const e = await failure(fetchJson(HTTP_URL, { fetchImpl: respond('no', { status }) }));
    expect(e).toMatchObject({ kind: 'auth', status });
  });

  it.each([404, 500, 502])('HTTP %i → http', async (status) => {
    const e = await failure(fetchJson(HTTP_URL, { fetchImpl: respond('x', { status }) }));
    expect(e).toMatchObject({ kind: 'http', status });
  });

  it.each([
    ['HTML content type', '<p>hi</p>', 'text/html; charset=utf-8'],
    ['HTML body with JSON content type', '<!DOCTYPE html><html></html>', 'application/json'],
    ['invalid JSON', '{"user_info":{"auth":1', 'application/json'],
    ['empty body', '', 'application/json'],
  ])('%s → parse', async (_label, body, type) => {
    const e = await failure(
      fetchJson(HTTP_URL, { fetchImpl: respond(body, { headers: { 'content-type': type } }) }),
    );
    expect(e.kind).toBe('parse');
  });

  it('fetchText does not parse', async () => {
    await expect(fetchText(HTTP_URL, { fetchImpl: respond('<html>') })).resolves.toBe('<html>');
  });
});

describe('fetchJson — blocked, offline (AC5)', () => {
  it('https page + http server → blocked/mixed-content', async () => {
    vi.stubGlobal('location', { protocol: 'https:' });
    const e = await failure(
      fetchJson(HTTP_URL, { fetchImpl: throwing(new TypeError('Failed to fetch')) }),
    );
    expect(e).toMatchObject({ kind: 'blocked', hint: 'mixed-content' });
  });

  it('https page + https server → blocked/cors', async () => {
    vi.stubGlobal('location', { protocol: 'https:' });
    const e = await failure(
      fetchJson(HTTPS_URL, { fetchImpl: throwing(new TypeError('Failed to fetch')) }),
    );
    expect(e).toMatchObject({ kind: 'blocked', hint: 'cors' });
  });

  it('http page + http server → blocked/cors', async () => {
    vi.stubGlobal('location', { protocol: 'http:' });
    const e = await failure(
      fetchJson(HTTP_URL, { fetchImpl: throwing(new TypeError('Failed to fetch')) }),
    );
    expect(e).toMatchObject({ kind: 'blocked', hint: 'cors' });
  });

  it('classifies the rewritten URL (an https proxy is not mixed content)', async () => {
    vi.stubGlobal('location', { protocol: 'https:' });
    const rewriter: UrlRewriter = { rewrite: () => 'https://proxy.example.test/x' };
    const e = await failure(
      fetchJson(HTTP_URL, { rewriter, fetchImpl: throwing(new TypeError('Failed to fetch')) }),
    );
    expect(e.hint).toBe('cors');
  });

  it('navigator.onLine === false → offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.stubGlobal('location', { protocol: 'https:' });
    const e = await failure(
      fetchJson(HTTP_URL, { fetchImpl: throwing(new TypeError('Failed to fetch')) }),
    );
    expect(e.kind).toBe('offline');
    expect(e.hint).toBeUndefined();
  });

  it('a non-TypeError failure is blocked without a hint', async () => {
    const e = await failure(fetchJson(HTTP_URL, { fetchImpl: throwing(new Error('boom')) }));
    expect(e).toMatchObject({ kind: 'blocked' });
    expect(e.hint).toBeUndefined();
  });
});

describe('fetchJson — timeout and abort (AC7)', () => {
  it(`times out after ${DEFAULT_TIMEOUT_MS} ms by default (fake timers)`, async () => {
    vi.useFakeTimers();
    const promise = failure(fetchJson(HTTP_URL, { fetchImpl: hanging }));
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    let settled = false;
    void promise.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await promise).kind).toBe('timeout');
  });

  it('honours a custom timeoutMs, even if fetch ignores the signal', async () => {
    const neverSettles: FetchImpl = () => new Promise(() => undefined);
    const e = await failure(fetchJson(HTTP_URL, { fetchImpl: neverSettles, timeoutMs: 20 }));
    expect(e.kind).toBe('timeout');
  });

  it('times out while reading a body that never ends', async () => {
    const stalled: FetchImpl = () =>
      Promise.resolve(new Response(new ReadableStream({ start() {} })));
    const e = await failure(fetchJson(HTTP_URL, { fetchImpl: stalled, timeoutMs: 20 }));
    expect(e.kind).toBe('timeout');
  });

  it('caller abort → aborted', async () => {
    const controller = new AbortController();
    const promise = failure(fetchJson(HTTP_URL, { fetchImpl: hanging, signal: controller.signal }));
    controller.abort();
    expect((await promise).kind).toBe('aborted');
  });

  it('an already aborted signal never calls fetch', async () => {
    const fetchImpl = vi.fn<FetchImpl>(respond('{}'));
    const e = await failure(fetchJson(HTTP_URL, { fetchImpl, signal: AbortSignal.abort() }));
    expect(e.kind).toBe('aborted');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('removes its abort listener from the caller signal', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await fetchJson(HTTP_URL, { fetchImpl: respond('{}'), signal: controller.signal });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('review regressions', () => {
  // Finding 1: PHP panels send JSON as text/html.
  it('parses valid JSON served as text/html', async () => {
    const fetchImpl = respond('{"user_info":{"auth":1}}', {
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    });
    await expect(fetchJson(HTTP_URL, { fetchImpl })).resolves.toEqual({ user_info: { auth: 1 } });
  });

  it.each([
    [
      '<!DOCTYPE html><html><body>Panel</body></html>',
      'text/html; charset=UTF-8',
      'HTML instead of JSON',
    ],
    ['<html>', 'application/json', 'HTML instead of JSON'],
    ['Not JSON at all', 'text/html', 'HTML instead of JSON'],
    ['{"a":', 'application/json', 'Invalid JSON'],
  ])('unparseable body %j (%s) → parse with cause %s', async (body, type, cause) => {
    const e = await failure(
      fetchJson(HTTP_URL, { fetchImpl: respond(body, { headers: { 'content-type': type } }) }),
    );
    expect(e.kind).toBe('parse');
    expect(e.cause).toBe(cause);
  });

  // Finding 4: an AbortError nobody asked for is a network failure, not a cancellation.
  it('AbortError without caller abort or timeout → blocked', async () => {
    const e = await failure(
      fetchJson(HTTP_URL, {
        fetchImpl: throwing(new DOMException('The operation was aborted', 'AbortError')),
        signal: new AbortController().signal,
      }),
    );
    expect(e.kind).toBe('blocked');
  });

  // Finding 6: unconsumed bodies are released.
  function trackedBody(chunks: number, chunkSize = 1024) {
    const cancel = vi.fn();
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= chunks) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(new Uint8Array(chunkSize));
      },
      cancel,
    });
    return { stream, cancel, sent: () => sent };
  }

  it.each([401, 403, 500])('HTTP %i with a large body → body cancelled', async (status) => {
    const body = trackedBody(Number.POSITIVE_INFINITY);
    const e = await failure(
      fetchJson(HTTP_URL, {
        fetchImpl: () => Promise.resolve(new Response(body.stream, { status })),
      }),
    );
    expect(e.status).toBe(status);
    expect(body.cancel).toHaveBeenCalledOnce();
    expect(body.sent()).toBeLessThan(100);
  });

  it('HTTP error with a small body → drained, not cancelled', async () => {
    const body = trackedBody(2);
    await failure(
      fetchJson(HTTP_URL, {
        fetchImpl: () => Promise.resolve(new Response(body.stream, { status: 404 })),
      }),
    );
    expect(body.cancel).not.toHaveBeenCalled();
    expect(body.sent()).toBe(2);
  });

  it('timeout during the body read cancels the body', async () => {
    const cancel = vi.fn();
    const stalled = new ReadableStream<Uint8Array>({ start() {}, cancel });
    const e = await failure(
      fetchJson(HTTP_URL, {
        fetchImpl: () => Promise.resolve(new Response(stalled)),
        timeoutMs: 20,
      }),
    );
    expect(e.kind).toBe('timeout');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('caller abort during the body read cancels the body', async () => {
    const cancel = vi.fn();
    const stalled = new ReadableStream<Uint8Array>({ start() {}, cancel });
    const controller = new AbortController();
    const promise = failure(
      fetchJson(HTTP_URL, {
        fetchImpl: () => Promise.resolve(new Response(stalled)),
        signal: controller.signal,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    expect((await promise).kind).toBe('aborted');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('decodes UTF-8 split across chunks', async () => {
    const bytes = new TextEncoder().encode('{"name":"Canal Português ✓"}');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    await expect(
      fetchJson(HTTP_URL, { fetchImpl: () => Promise.resolve(new Response(stream)) }),
    ).resolves.toEqual({ name: 'Canal Português ✓' });
  });

  // Finding 8: the inner cause chain survives (redacted) for diagnostics.
  it('keeps the inner cause chain with the host masked', async () => {
    const dns = Object.assign(new Error(`getaddrinfo ENOTFOUND ${HOST}`), { code: 'ENOTFOUND' });
    const tls = new Error(`TLS handshake with ${HOST}:8443 failed`, { cause: dns });
    const top = new TypeError(`fetch failed for ${HTTP_URL}`, { cause: tls });
    registerSecret(USER);
    registerSecret(PASS);
    const e = await failure(fetchJson(HTTP_URL, { fetchImpl: throwing(top) }));
    const c1 = e.cause as Error;
    const c2 = c1.cause as Error;
    const c3 = c2.cause as Error;
    expect(c1.name).toBe('TypeError');
    expect(c2.message).toBe('TLS handshake with ***:8443 failed');
    expect(c3.message).toContain('ENOTFOUND');
    const all = JSON.stringify([c1.message, c2.message, c3.message, e.message, String(e)]);
    for (const secret of [HOST, USER, PASS]) expect(all).not.toContain(secret);
    expect(c1.stack).toBeUndefined();
  });

  it('adds a system error code missing from the message', async () => {
    const refused = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
    const e = await failure(
      fetchJson(HTTP_URL, {
        fetchImpl: throwing(new TypeError('fetch failed', { cause: refused })),
      }),
    );
    expect(((e.cause as Error).cause as Error).message).toBe('connect failed (ECONNREFUSED)');
  });

  it('limits the cause chain depth', async () => {
    let cause: Error = new Error('level 5');
    for (let i = 4; i >= 1; i--) cause = new Error(`level ${i}`, { cause });
    const e = await failure(fetchJson(HTTP_URL, { fetchImpl: throwing(cause) }));
    const c3 = ((e.cause as Error).cause as Error).cause as Error;
    expect(c3.message).toBe('level 3');
    expect(c3.cause).toBeUndefined();
  });
});

describe('fetchJson — no leaks', () => {
  it('never logs or exposes the host, username or password', async () => {
    registerSecret(USER);
    registerSecret(PASS);
    vi.stubGlobal('location', { protocol: 'https:' });
    const errors = [
      await failure(
        fetchJson(HTTP_URL, { fetchImpl: throwing(new TypeError(`fail ${HTTP_URL}`)) }),
      ),
      await failure(fetchJson(HTTP_URL, { fetchImpl: respond('', { status: 401 }) })),
      await failure(fetchJson(HTTP_URL, { fetchImpl: respond(`<html>${HOST}</html>`) })),
      await failure(fetchJson(HTTP_URL, { fetchImpl: respond(`{"x":"${PASS}"`) })),
    ];
    const entries = getLogEntries();
    expect(entries.length).toBe(errors.length);
    const text = [
      ...errors.map((e) =>
        [e.message, String(e.target), JSON.stringify(e), String(e.cause)].join(' '),
      ),
      ...entries.map((e) => `${e.message} ${e.context ?? ''}`),
    ].join('\n');
    expect(text).not.toContain(HOST);
    expect(text).not.toContain(USER);
    expect(text).not.toContain(PASS);
    expect(text).toContain('http://***/player_api.php');
  });
});
