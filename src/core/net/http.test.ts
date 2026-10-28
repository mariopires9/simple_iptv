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
