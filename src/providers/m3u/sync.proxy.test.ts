// @vitest-environment node
// PRX-01 AC1: the M3U download goes through the list's data rewriter (personal proxy only when
// the list routes everything, `all`; direct for `streams` and off). MSW panel + fake-indexeddb +
// real WebCrypto vault, like sync.test.ts. Synthetic hosts and tokens only.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { credentialVault } from '@/core/crypto';
import { closeDatabase, openDatabase, sourcesRepo, type ProxyRouting } from '@/core/db';
import { clearSecrets } from '@/core/log';
import type { FetchImpl } from '@/core/net';
import { rewritersForSource } from '@/core/session';
import { WorkerTaskError, type TaskContext } from '@/core/worker';
import { XTREAM_TEST_BASE_URL, XTREAM_TEST_CREDENTIALS, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { syncM3uSource } from './sync';

const server = createMswServer(...xtreamHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

const SOURCE_ID = 'm3u-proxy';
const SECRET_REF = `source:${SOURCE_ID}:url`;
const { username: USER, password: PASS } = XTREAM_TEST_CREDENTIALS;
const GET_PHP = `${XTREAM_TEST_BASE_URL}/get.php?username=${USER}&password=${PASS}&type=m3u_plus`;
const PROXY = 'https://pc.example.test';
const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
const PROXY_PREFIX = `${PROXY}/v1/${TOKEN}/u/`;

const ctx: TaskContext = {
  progress() {},
  cancelled: false,
  throwIfCancelled() {
    if (this.cancelled) throw new WorkerTaskError('cancelled');
  },
};

/** Records every requested URL and plays the proxy: decodes `u/<b64u>` and fetches upstream. */
function proxyingFetch(seen: string[]): FetchImpl {
  return (url, init) => {
    seen.push(url);
    if (!url.startsWith(PROXY_PREFIX)) return fetch(url, init);
    const encoded = url.slice(PROXY_PREFIX.length).split('/')[0] ?? '';
    return fetch(Buffer.from(encoded, 'base64url').toString('utf8'), init);
  };
}

async function seed(proxy: ProxyRouting | undefined) {
  await sourcesRepo.put({
    id: SOURCE_ID,
    kind: 'm3u-url',
    name: 'My list',
    secretRef: SECRET_REF,
    prefs: proxy ? { liveFormat: 'auto', proxy } : { liveFormat: 'auto' },
    createdAt: 1,
    lastSyncStatus: 'never',
    stats: { live: 0, movies: 0, series: 0 },
  });
  await credentialVault.put(SECRET_REF, GET_PHP);
}

beforeEach(async () => {
  await openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
});
afterEach(async () => {
  server.resetHandlers();
  await closeDatabase();
  clearSecrets();
});

const rewriterFor = (source: Parameters<typeof rewritersForSource>[0]) =>
  rewritersForSource(source, {
    loadProxy: () => Promise.resolve({ baseUrl: PROXY, token: TOKEN }),
  }).then((r) => r.data);

describe('M3U download through the personal proxy (PRX-01)', () => {
  it('`all`: the list is downloaded through the proxy', async () => {
    await seed('all');
    const seen: string[] = [];
    const result = await syncM3uSource({ sourceId: SOURCE_ID }, ctx, {
      fetchImpl: proxyingFetch(seen),
      rewriterFor,
    });
    expect(result.status).toBe('ok');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.startsWith(PROXY_PREFIX)).toBe(true);
    expect(seen[0]?.endsWith('/get.php')).toBe(true);
  });

  it('`streams` (and the default, off): the download stays direct', async () => {
    for (const routing of ['streams', undefined] as const) {
      await seed(routing);
      const seen: string[] = [];
      const result = await syncM3uSource({ sourceId: SOURCE_ID }, ctx, {
        fetchImpl: proxyingFetch(seen),
        rewriterFor,
      });
      expect(result.status).toBe('ok');
      expect(seen).toEqual([GET_PHP]);
    }
  });
});
