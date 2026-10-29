// SRC-09: the diagnostics run — one request through the existing clients, none for a file or
// while offline, and no secret ever in the result.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Source } from '@/core/db';
import { clearLogBuffer, clearSecrets, getLogEntries } from '@/core/log';
import { NetError } from '@/core/net';
import type { Capabilities } from '@/core/platform';
import { testConnection, type XtreamConnectionReport } from '@/providers/xtream';
import { XTREAM_TEST_BASE_URL, XTREAM_TEST_CREDENTIALS, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { CODECS } from './codecs';
import { runDiagnostics, type DiagnosticsDeps } from './runDiagnostics';

const server = createMswServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  clearSecrets();
  clearLogBuffer();
});

// Fictitious values only (CLAUDE.md).
const HOST = 'panel.example.test';
const USER = 'jdoe';
const PASS = 'testpass';
const LIST_URL = `http://lists.example.test/get.php?username=${USER}&password=${PASS}&type=m3u`;

const caps: Capabilities = {
  mse: true,
  mms: false,
  nativeHls: false,
  isSafari: false,
  isIOS: false,
  pip: true,
  fullscreenApi: true,
  canPlay: () => true,
};

const source = (overrides: Partial<Source> = {}): Source => ({
  id: 'tv',
  kind: 'xtream',
  name: 'Living room',
  serverUrl: `http://${HOST}:8080`,
  username: USER,
  secretRef: 'source:tv:password',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
  ...overrides,
});

function deps(overrides: Partial<DiagnosticsDeps> = {}): Partial<DiagnosticsDeps> {
  return {
    readPassword: () => Promise.resolve(PASS),
    readListUrl: () => Promise.resolve(LIST_URL),
    testXtream: vi.fn(),
    probeList: vi.fn(() => Promise.resolve()),
    capabilities: () => caps,
    codecs: () => CODECS.map((codec) => ({ codec, mediaSource: true, native: false })),
    pageProtocol: () => 'https:',
    offline: () => false,
    now: () => Date.UTC(2026, 9, 29, 12),
    ...overrides,
  };
}

const okReport = (extra: Partial<XtreamConnectionReport> = {}): XtreamConnectionReport => ({
  ok: true,
  https: false,
  corsApi: 'ok',
  baseUrl: `http://${HOST}:8080`,
  account: { status: 'Active', formats: ['m3u8', 'ts'] },
  problems: [],
  ...extra,
});

const byId = (result: Awaited<ReturnType<typeof runDiagnostics>>) =>
  Object.fromEntries(result.checks.map((c) => [c.id, c]));

describe('runDiagnostics — Xtream', () => {
  it('runs the connection test with the stored password and reports every check', async () => {
    const testXtream = vi.fn(() => Promise.resolve(okReport()));
    const result = await runDiagnostics(source(), { deps: deps({ testXtream }) });

    expect(testXtream).toHaveBeenCalledTimes(1);
    expect(testXtream).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: `http://${HOST}:8080`, username: USER, password: PASS }),
    );
    expect(result.checks.map((c) => c.id)).toEqual([
      'https',
      'api',
      'liveFormat',
      'browser',
      'codecs',
    ]);
    const checks = byId(result);
    expect(checks.https).toMatchObject({ status: 'error', reason: 'http-blocked' });
    expect(checks.api).toMatchObject({ status: 'ok' });
    expect(checks.liveFormat).toMatchObject({ status: 'ok', allowed: ['m3u8', 'ts'] });
    expect(result.maskedAddress).toBe('http://***/');
  });

  it('mixed content: the API check says so, and the automatic HTTPS attempt is reported', async () => {
    const error = new NetError({ kind: 'blocked', hint: 'mixed-content' });
    const testXtream = vi.fn(() =>
      Promise.resolve({
        ...okReport(),
        ok: false,
        corsApi: 'blocked' as const,
        account: undefined,
        error,
        httpsCheck: { baseUrl: `https://${HOST}`, ok: true },
      }),
    );
    const checks = byId(await runDiagnostics(source(), { deps: deps({ testXtream }) }));
    expect(checks.api).toMatchObject({ status: 'error', reason: 'mixed-content' });
    expect(checks.https).toMatchObject({ httpsAvailable: true });
  });

  it('offline: no request at all', async () => {
    const testXtream = vi.fn();
    const checks = byId(
      await runDiagnostics(source(), { deps: deps({ testXtream, offline: () => true }) }),
    );
    expect(testXtream).not.toHaveBeenCalled();
    expect(checks.api).toMatchObject({ status: 'skipped', reason: 'offline' });
  });

  it('an unreadable password skips the API check with an explanation', async () => {
    const testXtream = vi.fn();
    const checks = byId(
      await runDiagnostics(source(), {
        deps: deps({ testXtream, readPassword: () => Promise.reject(new Error('key lost')) }),
      }),
    );
    expect(testXtream).not.toHaveBeenCalled();
    expect(checks.api).toMatchObject({ status: 'skipped', reason: 'no-secret' });
  });

  it('against the synthetic panel (real client): API ok, account formats read', async () => {
    server.use(...xtreamHandlers());
    const checks = byId(
      await runDiagnostics(
        source({ serverUrl: XTREAM_TEST_BASE_URL, username: XTREAM_TEST_CREDENTIALS.username }),
        {
          deps: deps({
            testXtream: testConnection,
            readPassword: () => Promise.resolve(XTREAM_TEST_CREDENTIALS.password),
          }),
        },
      ),
    );
    expect(checks.api).toMatchObject({ status: 'ok', reason: 'ok' });
    expect(checks.liveFormat).toHaveProperty('allowed');
  });

  it('a rejected login: reachable (no CORS problem) but the credentials are wrong', async () => {
    server.use(...xtreamHandlers({ auth: 'fail' }));
    const checks = byId(
      await runDiagnostics(source({ serverUrl: XTREAM_TEST_BASE_URL }), {
        deps: deps({ testXtream: testConnection }),
      }),
    );
    expect(checks.api).toMatchObject({ status: 'warning', reason: 'auth-rejected' });
  });

  it('caller cancellation rejects', async () => {
    const controller = new AbortController();
    const testXtream = vi.fn(() => {
      controller.abort();
      return Promise.reject(new NetError({ kind: 'aborted' }));
    });
    await expect(
      runDiagnostics(source(), { signal: controller.signal, deps: deps({ testXtream }) }),
    ).rejects.toBeInstanceOf(NetError);
  });
});

describe('runDiagnostics — M3U', () => {
  const m3u = source({ kind: 'm3u-url', serverUrl: undefined, username: undefined });

  it('probes the first bytes of the list URL read from the vault', async () => {
    const probeList = vi.fn(() => Promise.resolve());
    const result = await runDiagnostics(m3u, { deps: deps({ probeList }) });
    expect(probeList).toHaveBeenCalledWith(LIST_URL, undefined);
    const checks = byId(result);
    expect(checks.api).toMatchObject({ status: 'ok' });
    expect(checks.https).toMatchObject({ status: 'error', reason: 'http-blocked' });
    expect(checks.liveFormat).toMatchObject({ reason: 'per-channel' });
    expect(result.maskedAddress).toBe('http://***/get.php');
  });

  it('a CORS block is classified from the NetError', async () => {
    const probeList = vi.fn(() =>
      Promise.reject(new NetError({ kind: 'blocked', hint: 'cors', url: LIST_URL })),
    );
    const checks = byId(await runDiagnostics(m3u, { deps: deps({ probeList }) }));
    expect(checks.api).toMatchObject({ status: 'error', reason: 'cors' });
    expect(checks.api?.actions).toContain('local-file');
  });

  it('a local file skips every network check', async () => {
    const probeList = vi.fn();
    const readListUrl = vi.fn();
    const result = await runDiagnostics(
      source({ kind: 'm3u-file', serverUrl: undefined, username: undefined, secretRef: undefined }),
      { deps: deps({ probeList, readListUrl }) },
    );
    expect(probeList).not.toHaveBeenCalled();
    expect(readListUrl).not.toHaveBeenCalled();
    const checks = byId(result);
    expect(checks.https).toMatchObject({ status: 'skipped', reason: 'not-applicable' });
    expect(checks.api).toMatchObject({ status: 'skipped', reason: 'not-applicable' });
    expect(checks.browser).toMatchObject({ status: 'ok' });
    expect(result.maskedAddress).toBeUndefined();
  });
});

describe('no secret leaves the run', () => {
  it('the result and the logs contain no host, username, password or list URL', async () => {
    const testXtream = vi.fn(() =>
      Promise.resolve({
        ...okReport(),
        ok: false,
        error: new NetError({
          kind: 'blocked',
          hint: 'cors',
          url: `http://${HOST}:8080/player_api.php?username=${USER}&password=${PASS}`,
        }),
      }),
    );
    const xtream = await runDiagnostics(source(), { deps: deps({ testXtream }) });
    const list = await runDiagnostics(
      source({ kind: 'm3u-url', serverUrl: undefined, username: undefined }),
      { deps: deps() },
    );
    const text = JSON.stringify([xtream, list, getLogEntries()]);
    for (const secret of [HOST, 'lists.example.test', USER, PASS, LIST_URL]) {
      expect(text).not.toContain(secret);
    }
  });
});
