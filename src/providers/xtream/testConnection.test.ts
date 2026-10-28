// SRC-02 AC2–AC7 against the synthetic MSW panel (QA-01) in its three variants.
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLogBuffer, clearSecrets, getLogEntries } from '@/core/log';
import { NetError } from '@/core/net';
import {
  XTREAM_TEST_BASE_URL,
  XTREAM_TEST_CREDENTIALS,
  xtreamFixtures,
  xtreamHandlers,
  type XtreamVariant,
} from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { createXtreamClient } from './client';
import { InvalidServerUrlError } from './normalizeServerUrl';
import { testConnection, type TestConnectionOptions } from './testConnection';

const server = createMswServer(...xtreamHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSecrets();
  clearLogBuffer();
});
afterAll(() => server.close());

const HOST = 'panel.example.test';
const HTTPS_BASE = `https://${HOST}:8443`;
const { username: USER, password: PASS } = XTREAM_TEST_CREDENTIALS;
const VARIANTS: XtreamVariant[] = ['A', 'B', 'C'];
/** Before the fixtures' exp_date (2030-01-01) and after their timestamp_now (2026-01-01). */
const NOW = Date.UTC(2026, 9, 28);

const options = (extra: Partial<TestConnectionOptions> = {}): TestConnectionOptions => ({
  baseUrl: `${HOST}:8080/player_api.php`,
  username: USER,
  password: PASS,
  now: () => NOW,
  ...extra,
});

const codes = (report: { problems: { code: string }[] }) => report.problems.map((p) => p.code);

/** Serves an arbitrary `player_api.php` auth body on the default panel. */
function serveAuth(userInfo: Record<string, unknown>, serverInfo?: Record<string, unknown>) {
  server.use(
    http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, () =>
      HttpResponse.json({
        user_info: { ...xtreamFixtures.authOk.user_info, ...userInfo },
        server_info: { ...xtreamFixtures.authOk.server_info, ...serverInfo },
      }),
    ),
  );
}

describe.each(VARIANTS)('testConnection — panel variant %s', (variant) => {
  it('AC1+AC2: valid credentials → ok report with the account', async () => {
    server.use(...xtreamHandlers({ variant }));
    const report = await testConnection(options());
    expect(report).toMatchObject({
      ok: true,
      https: false,
      corsApi: 'ok',
      baseUrl: XTREAM_TEST_BASE_URL,
      account: {
        status: 'Active',
        expiresAt: 1893456000 * 1000,
        maxConnections: 2,
        activeConnections: 0,
        formats: ['m3u8', 'ts'],
      },
    });
    expect(codes(report)).toEqual(['http-only']);
    expect(report.problems[0]).toMatchObject({
      severity: 'warning',
      fix: 'see-connection-options',
    });
    expect(report.error).toBeUndefined();
    expect(report.httpsCheck).toBeUndefined();
  });

  it('AC3: wrong password (user_info.auth = 0) → auth error', async () => {
    server.use(...xtreamHandlers({ variant }));
    const report = await testConnection(options({ password: 'wrongpass' }));
    expect(report.ok).toBe(false);
    expect(report.error).toBeInstanceOf(NetError);
    expect(report.error?.kind).toBe('auth');
    expect(report.problems).toEqual([
      expect.objectContaining({ code: 'auth-failed', severity: 'error', fix: 'check-credentials' }),
    ]);
    expect(report.account).toBeUndefined();
  });

  it.each(['http-401', 'http-403'] as const)('AC3: %s → auth error', async (error) => {
    server.use(...xtreamHandlers({ variant, error }));
    const report = await testConnection(options());
    expect(report.error).toMatchObject({ kind: 'auth', status: Number(error.slice(5)) });
    expect(codes(report)).toEqual(['auth-failed']);
  });

  it.each([
    ['expired', 'account-expired', 'renew-subscription', 'Expired'],
    ['banned', 'account-banned', 'contact-provider', 'Banned'],
  ] as const)('AC4: %s account → ok false with %s', async (auth, code, fix, status) => {
    server.use(...xtreamHandlers({ variant, auth }));
    const report = await testConnection(options());
    expect(report.ok).toBe(false);
    expect(report.account?.status).toBe(status);
    expect(report.problems[0]).toMatchObject({ code, fix, severity: 'error' });
    expect(report.error).toBeUndefined();
  });

  it('AC5: network failure from an https page to an http server → mixed-content', async () => {
    vi.stubGlobal('location', { protocol: 'https:' });
    server.use(...xtreamHandlers({ variant, error: 'network' }));
    const report = await testConnection(options());
    expect(report).toMatchObject({ ok: false, corsApi: 'blocked', https: false });
    expect(report.error).toMatchObject({ kind: 'blocked', hint: 'mixed-content' });
    expect(codes(report)).toEqual(['blocked-mixed-content']);
  });

  it('AC6: http server with https_port → https is tried and used', async () => {
    server.use(
      ...xtreamHandlers({ variant, auth: 'ok-https' }),
      ...xtreamHandlers({ variant, auth: 'ok-https', baseUrl: HTTPS_BASE }),
    );
    const report = await testConnection(options());
    expect(report).toMatchObject({
      ok: true,
      https: true,
      baseUrl: HTTPS_BASE,
      httpsCheck: { baseUrl: HTTPS_BASE, ok: true },
      account: { formats: ['m3u8', 'ts', 'rtmp'] },
    });
    expect(report.problems).toEqual([]);
  });

  it('AC7: no answer within timeoutMs → timeout', async () => {
    server.use(...xtreamHandlers({ variant, error: 'timeout' }));
    const report = await testConnection(options({ timeoutMs: 50 }));
    expect(report.ok).toBe(false);
    expect(report.error?.kind).toBe('timeout');
    expect(codes(report)).toEqual(['timeout']);
    expect(report.problems[0]?.fix).toBe('retry-later');
  });
});

describe('testConnection — account states (AC4)', () => {
  it.each([
    ['Disabled', 'account-disabled'],
    ['disabled', 'account-disabled'],
    ['EXPIRED', 'account-expired'],
    ['Inactive', 'account-inactive'],
    ['Trial-Pending', 'account-inactive'],
  ])('status %s → %s', async (status, code) => {
    serveAuth({ status });
    const report = await testConnection(options());
    expect(report.ok).toBe(false);
    expect(codes(report)[0]).toBe(code);
  });

  it('Active but exp_date in the past → account-expired', async () => {
    serveAuth({ exp_date: String(NOW / 1000 - 60) });
    const report = await testConnection(options());
    expect(report.ok).toBe(false);
    expect(codes(report)[0]).toBe('account-expired');
  });

  it('no exp_date (unlimited) and no status → ok', async () => {
    serveAuth({ exp_date: null, status: undefined });
    const report = await testConnection(options());
    expect(report.ok).toBe(true);
    expect(report.account).toMatchObject({ status: 'Unknown' });
    expect(report.account?.expiresAt).toBeUndefined();
  });

  it('all connections in use → warning, still ok', async () => {
    serveAuth({ active_cons: '2', max_connections: '2' });
    const report = await testConnection(options());
    expect(report.ok).toBe(true);
    expect(codes(report)).toEqual(['max-connections-reached', 'http-only']);
  });
});

describe('testConnection — network errors', () => {
  it('AC5: https server blocked → cors', async () => {
    vi.stubGlobal('location', { protocol: 'https:' });
    server.use(...xtreamHandlers({ baseUrl: HTTPS_BASE, error: 'network' }));
    const report = await testConnection(options({ baseUrl: HTTPS_BASE }));
    expect(report.error).toMatchObject({ kind: 'blocked', hint: 'cors' });
    expect(report).toMatchObject({ https: true, corsApi: 'blocked' });
    expect(codes(report)).toEqual(['blocked-cors']);
  });

  it('AC5: offline → offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    server.use(...xtreamHandlers({ error: 'network' }));
    const report = await testConnection(options());
    expect(report.error?.kind).toBe('offline');
    expect(report.corsApi).toBe('unknown');
    expect(codes(report)).toEqual(['offline']);
  });

  it.each([
    ['http-500', 'http', 'http-error'],
    ['http-404', 'http', 'http-error'],
    ['html', 'parse', 'invalid-response'],
    ['invalid-json', 'parse', 'invalid-response'],
  ] as const)('%s → %s / %s', async (error, kind, code) => {
    server.use(...xtreamHandlers({ error }));
    const report = await testConnection(options());
    expect(report.error?.kind).toBe(kind);
    expect(codes(report)).toEqual([code]);
  });

  it('a JSON body without user_info → invalid-response', async () => {
    server.use(http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, () => HttpResponse.json([])));
    const report = await testConnection(options());
    expect(report.error?.kind).toBe('parse');
  });

  it('caller abort is thrown, not reported', async () => {
    server.use(...xtreamHandlers({ error: 'timeout' }));
    const controller = new AbortController();
    const promise = testConnection(options({ signal: controller.signal }));
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'NetError', kind: 'aborted' });
  });

  it('AC1: an invalid server URL throws a typed error before any request', async () => {
    await expect(testConnection(options({ baseUrl: 'ftp://panel.example.test' }))).rejects.toThrow(
      InvalidServerUrlError,
    );
    await expect(
      testConnection(options({ baseUrl: `http://${USER}:${PASS}@${HOST}:8080` })),
    ).rejects.toMatchObject({ reason: 'credentials' });
  });
});

describe('testConnection — automatic HTTPS (AC6)', () => {
  it('https_port present but https unreachable → http base kept with warnings', async () => {
    server.use(
      ...xtreamHandlers({ auth: 'ok-https' }),
      ...xtreamHandlers({ baseUrl: HTTPS_BASE, error: 'network' }),
    );
    const report = await testConnection(options());
    expect(report).toMatchObject({
      ok: true,
      https: false,
      baseUrl: XTREAM_TEST_BASE_URL,
      httpsCheck: { baseUrl: HTTPS_BASE, ok: false, error: 'blocked' },
    });
    expect(codes(report)).toEqual(['https-unavailable', 'http-only']);
  });

  it('https answers with a rejection → https not used', async () => {
    server.use(
      ...xtreamHandlers({ auth: 'ok-https' }),
      ...xtreamHandlers({ baseUrl: HTTPS_BASE, auth: 'fail' }),
    );
    const report = await testConnection(options());
    expect(report.https).toBe(false);
    expect(report.httpsCheck).toMatchObject({ ok: false, error: 'auth' });
  });

  it('uses the entered host, not server_info.url', async () => {
    serveAuth({}, { url: 'elsewhere.example.test', https_port: '8443' });
    const seen: string[] = [];
    server.use(
      http.get('https://*/player_api.php', ({ request }) => {
        seen.push(new URL(request.url).host);
        return HttpResponse.json(xtreamFixtures.authOk);
      }),
    );
    const report = await testConnection(options());
    expect(seen).toEqual([`${HOST}:8443`]);
    expect(report.baseUrl).toBe(HTTPS_BASE);
  });

  it('does not try https when the server is already https', async () => {
    server.use(...xtreamHandlers({ baseUrl: HTTPS_BASE, auth: 'ok-https' }));
    const report = await testConnection(options({ baseUrl: `${HTTPS_BASE}/` }));
    expect(report).toMatchObject({ ok: true, https: true, baseUrl: HTTPS_BASE });
    expect(report.httpsCheck).toBeUndefined();
    expect(report.problems).toEqual([]);
  });

  it('an invalid https_port is ignored', async () => {
    serveAuth({}, { https_port: '70000' });
    const report = await testConnection(options());
    expect(report.httpsCheck).toBeUndefined();
  });
});

describe('testConnection — no credential or host leaks', () => {
  it('logs, NetError messages and problem messages never contain username, password or host', async () => {
    vi.stubGlobal('location', { protocol: 'https:' });
    const errors: NetError[] = [];
    const scenarios: Array<() => void> = [
      () => server.use(...xtreamHandlers({ error: 'network' })),
      () => server.use(...xtreamHandlers({ error: 'http-401' })),
      () => server.use(...xtreamHandlers({ error: 'http-500' })),
      () => server.use(...xtreamHandlers({ error: 'html' })),
      () => server.use(...xtreamHandlers({ error: 'invalid-json' })),
      () => server.use(...xtreamHandlers({ auth: 'expired' })),
      () =>
        server.use(
          ...xtreamHandlers({ auth: 'ok-https' }),
          ...xtreamHandlers({ baseUrl: HTTPS_BASE, error: 'network' }),
        ),
    ];
    const texts: string[] = [];
    for (const setup of scenarios) {
      server.resetHandlers();
      setup();
      const report = await testConnection(options());
      if (report.error) errors.push(report.error);
      texts.push(...report.problems.map((p) => p.message));
    }
    const wrong = await testConnection(options({ password: 'wrongpass' }));
    if (wrong.error) errors.push(wrong.error);
    expect(errors.length).toBeGreaterThanOrEqual(6);

    for (const e of errors) {
      texts.push(e.message, String(e.target), JSON.stringify(e), String(e), String(e.cause));
    }
    for (const entry of getLogEntries()) texts.push(entry.message, entry.context ?? '');
    const all = texts.join('\n');
    expect(getLogEntries().length).toBeGreaterThan(0);
    for (const secret of [USER, PASS, 'wrongpass', HOST]) expect(all).not.toContain(secret);
  });
});

// Review finding 2: https page + http panel blocked as mixed content → HTTPS probes on the same host.
describe('testConnection — HTTPS probes after a mixed-content block', () => {
  const SAME_PORT = `https://${HOST}:8080`;
  const DEFAULT_PORT = `https://${HOST}`;

  /** Records every host:port contacted, to prove credentials only go to the entered host. */
  function recordHosts(): string[] {
    const seen: string[] = [];
    server.events.on('request:start', ({ request }) => {
      seen.push(new URL(request.url).origin);
    });
    return seen;
  }

  beforeEach(() => {
    vi.stubGlobal('location', { protocol: 'https:' });
    server.use(...xtreamHandlers({ error: 'network' }));
  });
  afterEach(() => {
    server.events.removeAllListeners();
  });

  it('https on the same port works → used, https true', async () => {
    server.use(...xtreamHandlers({ baseUrl: SAME_PORT }));
    const seen = recordHosts();
    const report = await testConnection(options());
    expect(report).toMatchObject({
      ok: true,
      https: true,
      corsApi: 'ok',
      baseUrl: SAME_PORT,
      httpsCheck: { baseUrl: SAME_PORT, ok: true },
      account: { status: 'Active' },
    });
    expect(report.httpsAttempts).toHaveLength(1);
    expect(report.problems).toEqual([]);
    expect(seen).toEqual([XTREAM_TEST_BASE_URL, SAME_PORT]);
  });

  it('same port fails, 443 works → 443 used', async () => {
    server.use(
      ...xtreamHandlers({ baseUrl: SAME_PORT, error: 'network' }),
      ...xtreamHandlers({ baseUrl: DEFAULT_PORT }),
    );
    const seen = recordHosts();
    const report = await testConnection(options());
    expect(report).toMatchObject({ ok: true, https: true, baseUrl: DEFAULT_PORT });
    expect(report.httpsAttempts).toEqual([
      { baseUrl: SAME_PORT, ok: false, error: 'blocked' },
      { baseUrl: DEFAULT_PORT, ok: true },
    ]);
    expect(seen).toEqual([XTREAM_TEST_BASE_URL, SAME_PORT, DEFAULT_PORT]);
  });

  it('no https anywhere → blocked-mixed-content with fix codes', async () => {
    server.use(
      ...xtreamHandlers({ baseUrl: SAME_PORT, error: 'network' }),
      ...xtreamHandlers({ baseUrl: DEFAULT_PORT, error: 'network' }),
    );
    const report = await testConnection(options());
    expect(report).toMatchObject({
      ok: false,
      https: false,
      corsApi: 'blocked',
      baseUrl: XTREAM_TEST_BASE_URL,
      error: { kind: 'blocked', hint: 'mixed-content' },
      httpsCheck: { baseUrl: DEFAULT_PORT, ok: false, error: 'blocked' },
    });
    expect(report.httpsAttempts).toHaveLength(2);
    expect(report.problems).toEqual([
      expect.objectContaining({
        code: 'blocked-mixed-content',
        fix: 'use-https',
        fixes: ['use-https', 'use-local-file', 'use-proxy'],
      }),
    ]);
  });

  it('no port entered → only https://host is probed', async () => {
    server.use(
      ...xtreamHandlers({ baseUrl: `http://${HOST}`, error: 'network' }),
      ...xtreamHandlers({ baseUrl: DEFAULT_PORT }),
    );
    const report = await testConnection(options({ baseUrl: HOST }));
    expect(report).toMatchObject({ ok: true, baseUrl: DEFAULT_PORT });
    expect(report.httpsAttempts).toEqual([{ baseUrl: DEFAULT_PORT, ok: true }]);
  });

  it('https rejects the credentials → auth-failed, no further probes', async () => {
    server.use(...xtreamHandlers({ baseUrl: SAME_PORT, auth: 'fail' }));
    const seen = recordHosts();
    const report = await testConnection(options());
    expect(report).toMatchObject({ ok: false, https: true, error: { kind: 'auth' } });
    expect(codes(report)).toEqual(['auth-failed']);
    expect(seen).toEqual([XTREAM_TEST_BASE_URL, SAME_PORT]);
  });

  it('each probe uses probeTimeoutMs, not timeoutMs', async () => {
    server.use(
      ...xtreamHandlers({ baseUrl: SAME_PORT, error: 'timeout' }),
      ...xtreamHandlers({ baseUrl: DEFAULT_PORT, error: 'timeout' }),
    );
    const started = Date.now();
    const report = await testConnection(options({ probeTimeoutMs: 30 }));
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(report.httpsAttempts).toEqual([
      { baseUrl: SAME_PORT, ok: false, error: 'timeout' },
      { baseUrl: DEFAULT_PORT, ok: false, error: 'timeout' },
    ]);
    expect(codes(report)).toEqual(['blocked-mixed-content']);
  });

  it('an https server is never probed again', async () => {
    server.use(...xtreamHandlers({ baseUrl: HTTPS_BASE, error: 'network' }));
    const seen = recordHosts();
    const report = await testConnection(options({ baseUrl: HTTPS_BASE }));
    expect(report.httpsAttempts).toBeUndefined();
    expect(seen).toEqual([HTTPS_BASE]);
  });
});

describe('testConnection — review regressions', () => {
  // Finding 3: missing/null auth is not a rejection.
  it.each([undefined, null])('user_info.auth = %j → proceeds with the account', async (auth) => {
    serveAuth({ auth });
    const report = await testConnection(options());
    expect(report.ok).toBe(true);
    expect(report.account?.status).toBe('Active');
    expect(report.error).toBeUndefined();
  });

  it.each([0, '0', false])('user_info.auth = %j → auth-failed', async (auth) => {
    serveAuth({ auth });
    const report = await testConnection(options());
    expect(report.error?.kind).toBe('auth');
  });

  // Finding 4: an aborted kind without caller cancellation is reported, not thrown.
  it('an AbortError not caused by the caller is reported as a network failure', async () => {
    const fetchImpl = () => Promise.reject(new DOMException('aborted', 'AbortError'));
    const report = await testConnection(
      options({ fetchImpl, signal: new AbortController().signal }),
    );
    expect(report.ok).toBe(false);
    expect(report.error?.kind).toBe('blocked');
  });

  // Finding 5: the https_port probe has its own timeout and is skipped for unusable accounts.
  it('https_port probe uses probeTimeoutMs', async () => {
    server.use(
      ...xtreamHandlers({ auth: 'ok-https' }),
      ...xtreamHandlers({ baseUrl: HTTPS_BASE, error: 'timeout' }),
    );
    const report = await testConnection(options({ probeTimeoutMs: 30 }));
    expect(report).toMatchObject({
      ok: true,
      https: false,
      httpsCheck: { baseUrl: HTTPS_BASE, ok: false, error: 'timeout' },
    });
  });

  it.each(['Expired', 'Banned', 'Disabled', 'Paused'])(
    'no https_port probe for a %s account',
    async (status) => {
      serveAuth({ status }, { https_port: '8443' });
      const seen: string[] = [];
      server.events.on('request:start', ({ request }) => {
        seen.push(new URL(request.url).origin);
      });
      const report = await testConnection(options());
      server.events.removeAllListeners();
      expect(report.ok).toBe(false);
      expect(report.httpsCheck).toBeUndefined();
      expect(seen).toEqual([XTREAM_TEST_BASE_URL]);
    },
  );
});

describe('createXtreamClient', () => {
  it('normalizes the base URL and builds player_api.php URLs', async () => {
    const fetchImpl = vi.fn((_url: string) =>
      Promise.resolve(new Response(JSON.stringify(xtreamFixtures.authOk))),
    );
    const client = createXtreamClient({
      baseUrl: 'HTTP://Panel.Example.Test:8080/player_api.php',
      username: 'j doe',
      password: 'p&ss',
      fetchImpl,
    });
    expect(client.baseUrl).toBe('http://panel.example.test:8080');
    await client.authenticate();
    await client.call('get_live_streams', { category_id: 10, skip: undefined });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'http://panel.example.test:8080/player_api.php?username=j+doe&password=p%26ss',
      'http://panel.example.test:8080/player_api.php?username=j+doe&password=p%26ss&action=get_live_streams&category_id=10',
    ]);
  });

  it.each(VARIANTS)('call() returns raw JSON for variant %s', async (variant) => {
    server.use(...xtreamHandlers({ variant }));
    const client = createXtreamClient({
      baseUrl: XTREAM_TEST_BASE_URL,
      username: USER,
      password: PASS,
    });
    await expect(client.call('get_live_categories')).resolves.toEqual(
      xtreamFixtures.variants[variant].liveCategories,
    );
  });

  it('call() reports an auth-rejection body as auth', async () => {
    const client = createXtreamClient({
      baseUrl: XTREAM_TEST_BASE_URL,
      username: USER,
      password: 'wrongpass',
    });
    await expect(client.call('get_live_streams')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('authenticate() throws auth for auth = 0 and returns non-active accounts', async () => {
    const bad = createXtreamClient({
      baseUrl: XTREAM_TEST_BASE_URL,
      username: USER,
      password: 'nope1',
    });
    await expect(bad.authenticate()).rejects.toMatchObject({ name: 'NetError', kind: 'auth' });
    server.use(...xtreamHandlers({ auth: 'banned' }));
    const good = createXtreamClient({
      baseUrl: XTREAM_TEST_BASE_URL,
      username: USER,
      password: PASS,
    });
    await expect(good.authenticate()).resolves.toMatchObject({ account: { status: 'Banned' } });
  });

  it('uses the injected rewriter for API calls', async () => {
    const rewriter = { rewrite: vi.fn((url: string) => url) };
    const client = createXtreamClient({
      baseUrl: XTREAM_TEST_BASE_URL,
      username: USER,
      password: PASS,
      rewriter,
    });
    await client.authenticate();
    expect(rewriter.rewrite).toHaveBeenCalledWith(
      expect.stringContaining('/player_api.php?'),
      'api',
    );
  });

  it('registers the credentials as log secrets on creation', async () => {
    const { redact } = await import('@/core/log');
    createXtreamClient({
      baseUrl: XTREAM_TEST_BASE_URL,
      username: 'someuser',
      password: 'somepass',
    });
    expect(redact('someuser somepass')).toBe('*** ***');
  });
});
