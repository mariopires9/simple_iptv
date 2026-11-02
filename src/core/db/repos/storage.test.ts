// STO-01: storage estimates per list (AC1) and what each "Clear cached data" part removes and keeps
// (AC2–AC4), on fake-indexeddb.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb } from '../database';
import { openFreshDatabase } from '../test-utils';
import type { Source } from '../types';
import { catalogRepo } from './catalog';
import { favoritesRepo } from './favorites';
import { historyRepo } from './history';
import { settingsRepo } from './settings';
import { sourcesRepo } from './sources';
import { storageRepo } from './storage';
import { vaultStore } from './vault';

beforeEach(async () => {
  await openFreshDatabase();
});
afterEach(async () => {
  await closeDatabase();
});

function source(id: string): Source {
  return {
    id,
    kind: 'xtream',
    name: `List ${id}`,
    serverUrl: 'http://example.invalid:8080',
    username: 'test-user',
    secretRef: `secret-${id}`,
    prefs: { liveFormat: 'ts', proxy: 'streams' },
    createdAt: id === 'a' ? 1 : 2,
    lastSyncAt: 1_000,
    lastSyncStatus: 'ok',
    lastSyncByType: { live: { status: 'ok', at: 1_000, items: 3 } },
    stats: { live: 3, movies: 3, series: 3 },
    epgStatus: { status: 'ok', at: 1_000, lastOkAt: 1_000, programmes: 2 },
  };
}

async function seed(id: string) {
  await sourcesRepo.put(source(id));
  await vaultStore.putSecret({
    ref: `secret-${id}`,
    kid: 'kid-test',
    iv: new Uint8Array(12),
    ciphertext: new ArrayBuffer(8),
  });
  const categories = [{ externalId: '1', name: 'General' }];
  const items = [1, 2, 3].map((n) => ({
    externalId: String(n),
    categoryExternalId: '1',
    name: `Item ${n}`,
    streamPath: String(n),
  }));
  await catalogRepo.replaceForSource(id, 'live', { categories, items });
  await catalogRepo.replaceForSource(id, 'movie', { categories, items });
  await catalogRepo.replaceForSource(id, 'series', {
    categories,
    items: items.map(({ streamPath: _s, ...rest }) => rest),
  });
  await catalogRepo.putSeriesDetails({
    seriesKey: `${id}:series:1`,
    sourceId: id,
    fetchedAt: 1,
    seasons: [],
  });
  await catalogRepo.putSearchIndex({ sourceId: id, data: 'x'.repeat(1_000), builtAt: 1 });
  await favoritesRepo.add(`${id}:live:1`);
  await historyRepo.upsert({ itemKey: `${id}:movie:1`, positionSec: 10, completed: false });
  const db = await getDb();
  await db.epgPrograms.bulkPut([
    { channelEpgId: `${id}:live:1`, start: 1, end: 2, sourceId: id, title: 'Show' },
    { channelEpgId: `${id}:live:1`, start: 2, end: 3, sourceId: id, title: 'Show 2' },
  ]);
}

async function counts(id: string) {
  const db = await getDb();
  const prefix = `${id}:`;
  return {
    sources: await db.sources.where('id').equals(id).count(),
    secrets: await db.secrets.where('ref').equals(`secret-${id}`).count(),
    categories: await db.categories.where('sourceId').equals(id).count(),
    channels: await db.channels.where('sourceId').equals(id).count(),
    movies: await db.movies.where('sourceId').equals(id).count(),
    series: await db.series.where('sourceId').equals(id).count(),
    seriesDetails: await db.seriesDetails.where('seriesKey').startsWith(prefix).count(),
    favorites: await db.favorites.where('itemKey').startsWith(prefix).count(),
    history: await db.history.where('itemKey').startsWith(prefix).count(),
    epgPrograms: await db.epgPrograms.where('sourceId').equals(id).count(),
    searchIndex: await db.searchIndex.where('sourceId').equals(id).count(),
  };
}

const full = {
  sources: 1,
  secrets: 1,
  categories: 3,
  channels: 3,
  movies: 3,
  series: 3,
  seriesDetails: 1,
  favorites: 1,
  history: 1,
  epgPrograms: 2,
  searchIndex: 1,
};

async function seedSettings() {
  await settingsRepo.set('activeSourceId', 'a');
  await settingsRepo.set('lastChannelKey', 'a:live:1');
  await settingsRepo.set('liveFormatMemory', { 'a:live:1': 'mse' });
  await settingsRepo.set('parentalControl', { pin: 'hash' });
  await vaultStore.putSecret({
    ref: 'proxy:token',
    kid: 'kid-test',
    iv: new Uint8Array(12),
    ciphertext: new ArrayBuffer(8),
  });
}

async function settingsKept() {
  expect(await settingsRepo.get('activeSourceId')).toBe('a');
  expect(await settingsRepo.get('lastChannelKey')).toBe('a:live:1');
  expect(await settingsRepo.get('liveFormatMemory')).toEqual({ 'a:live:1': 'mse' });
  expect(await settingsRepo.get('parentalControl')).toEqual({ pin: 'hash' });
  expect(await vaultStore.getSecret('proxy:token')).toBeDefined();
}

describe('storageRepo.estimateSource (STO-01 AC1)', () => {
  it('counts the catalogue rows and estimates bytes from a sample', async () => {
    await seed('a');
    const estimate = await storageRepo.estimateSource('a');
    expect(estimate.catalogue).toMatchObject({ live: 3, movie: 3, series: 3, episodes: 1 });
    expect(estimate.catalogue.bytes).toBeGreaterThan(0);
    expect(estimate.search.bytes).toBeGreaterThanOrEqual(1_000);
    expect(estimate.guide.rows).toBe(2);
    expect(estimate.guide.bytes).toBeGreaterThan(0);
  });

  it('an empty list is zero; an aborted estimate rejects', async () => {
    await sourcesRepo.put(source('b'));
    const estimate = await storageRepo.estimateSource('b');
    expect(estimate.catalogue.bytes + estimate.search.bytes + estimate.guide.bytes).toBe(0);
    const controller = new AbortController();
    controller.abort(new Error('unmounted'));
    await expect(storageRepo.estimateSource('b', { signal: controller.signal })).rejects.toThrow(
      'unmounted',
    );
  });

  it('pauses between reads (idle chunks)', async () => {
    await seed('a');
    let pauses = 0;
    await storageRepo.estimateSource('a', {
      pause: () => {
        pauses++;
        return Promise.resolve();
      },
    });
    expect(pauses).toBeGreaterThan(5);
  });
});

describe('storageRepo clearing (STO-01 AC2–AC4)', () => {
  beforeEach(async () => {
    await seed('a');
    await seed('b');
    await seedSettings();
  });

  it('guide: removes every programme and the guide status, nothing else', async () => {
    await storageRepo.clearGuide();
    for (const id of ['a', 'b']) {
      expect(await counts(id)).toEqual({ ...full, epgPrograms: 0 });
      const kept = await sourcesRepo.get(id);
      expect(kept?.epgStatus).toBeUndefined();
      expect(kept).toMatchObject({ lastSyncAt: 1_000, lastSyncStatus: 'ok' });
    }
    await settingsKept();
  });

  it('search: removes every index, nothing else', async () => {
    await storageRepo.clearSearchIndexes();
    for (const id of ['a', 'b']) expect(await counts(id)).toEqual({ ...full, searchIndex: 0 });
    await settingsKept();
  });

  it('catalogue: removes only the selected list’s catalogue and resets its sync state', async () => {
    expect(await storageRepo.clearCatalogue(['a', 'missing'])).toEqual(['a']);
    expect(await counts('a')).toEqual({
      ...full,
      categories: 0,
      channels: 0,
      movies: 0,
      series: 0,
      seriesDetails: 0,
      searchIndex: 0,
    });
    expect(await counts('b')).toEqual(full);
    const a = await sourcesRepo.get('a');
    expect(a).toMatchObject({
      id: 'a',
      name: 'List a',
      secretRef: 'secret-a',
      serverUrl: 'http://example.invalid:8080',
      prefs: { liveFormat: 'ts', proxy: 'streams' },
      lastSyncStatus: 'never',
      stats: { live: 0, movies: 0, series: 0 },
    });
    expect(a?.lastSyncAt).toBeUndefined();
    expect(a?.lastSyncByType).toBeUndefined();
    expect(await sourcesRepo.get('b')).toMatchObject({ lastSyncAt: 1_000, lastSyncStatus: 'ok' });
    // Favorites and history keep their item keys: they resolve again after the re-sync.
    expect(await favoritesRepo.has('a:live:1')).toBe(true);
    expect(await historyRepo.get('a:movie:1')).toMatchObject({ positionSec: 10 });
    await settingsKept();
  });
});
