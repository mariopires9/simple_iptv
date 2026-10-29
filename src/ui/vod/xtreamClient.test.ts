// PRX-01: VOD/series details requests follow the list's data routing (proxy only for `all`).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { wipeAll, type ProxyRouting, type Source } from '@/core/db';
import { clearSecrets } from '@/core/log';
import type { FetchImpl } from '@/core/net';
import { savePersonalProxy } from '@/core/session';
import { xtreamClientFor } from './xtreamClient';

const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';

const source = (proxy?: ProxyRouting): Source => ({
  id: 'x1',
  kind: 'xtream',
  name: 'Panel',
  serverUrl: 'http://panel.example.test:8080',
  username: 'demo',
  secretRef: 'xtream:x1',
  prefs: proxy ? { liveFormat: 'auto', proxy } : { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
});

afterEach(async () => {
  clearSecrets();
  await wipeAll();
});

async function requestedUrl(proxy?: ProxyRouting): Promise<string> {
  const seen: string[] = [];
  const fetchImpl: FetchImpl = (url) => {
    seen.push(url);
    return Promise.resolve(Response.json({ info: {} }));
  };
  const client = await xtreamClientFor(source(proxy), {
    vault: { get: () => Promise.resolve('synthetic-pass') },
    fetchImpl,
  });
  await client.call('get_vod_info', { vod_id: 7 });
  return seen[0] ?? '';
}

describe('xtreamClientFor (PRX-01)', () => {
  it('`all` → the API goes through the proxy; `streams` and off → direct', async () => {
    await savePersonalProxy({ baseUrl: 'https://pc.example.test', token: TOKEN });
    expect(await requestedUrl('all')).toMatch(
      new RegExp(`^https://pc\\.example\\.test/v1/${TOKEN}/u/[A-Za-z0-9_-]+/player_api\\.php$`),
    );
    expect(await requestedUrl('streams')).toMatch(/^http:\/\/panel\.example\.test:8080\//);
    expect(await requestedUrl()).toMatch(/^http:\/\/panel\.example\.test:8080\//);
  });
});
