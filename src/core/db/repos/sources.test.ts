import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb } from '../database';
import { openFreshDatabase } from '../test-utils';
import type { Source } from '../types';
import { catalogRepo } from './catalog';
import { favoritesRepo } from './favorites';
import { historyRepo } from './history';
import { settingsRepo } from './settings';
import { sourcesRepo } from './sources';
import { vaultStore } from './vault';

beforeEach(async () => {
  await openFreshDatabase();
});

afterEach(async () => {
  await closeDatabase();
});

function source(id: string, createdAt: number, extra: Partial<Source> = {}): Source {
  return {
    id,
    kind: 'xtream',
    name: `Source ${id}`,
    serverUrl: 'http://example.invalid:8080',
    username: 'test-user',
    secretRef: `secret-${id}`,
    prefs: { liveFormat: 'auto' },
    createdAt,
    lastSyncStatus: 'never',
    stats: { live: 0, movies: 0, series: 0 },
    ...extra,
  };
}

/** Seeds every table with data for source `id`. */
async function seed(id: string) {
  await sourcesRepo.put(source(id, id === 'a' ? 1 : 2));
  await vaultStore.putSecret({
    ref: `secret-${id}`,
    iv: new Uint8Array(12),
    ciphertext: new ArrayBuffer(8),
  });
  const categories = [{ externalId: '1', name: 'General' }];
  const playable = [1, 2].map((n) => ({
    externalId: String(n),
    categoryExternalId: '1',
    name: `Item ${n}`,
    streamPath: String(n),
  }));
  await catalogRepo.replaceForSource(id, 'live', { categories, items: playable });
  await catalogRepo.replaceForSource(id, 'movie', { categories, items: playable });
  await catalogRepo.replaceForSource(id, 'series', {
    categories,
    items: playable.map(({ streamPath: _s, ...rest }) => rest),
  });
  await catalogRepo.putSeriesDetails({
    seriesKey: `${id}:series:1`,
    sourceId: id,
    fetchedAt: 1,
    seasons: [],
  });
  await favoritesRepo.add(`${id}:live:1`);
  await favoritesRepo.add(`${id}:movie:2`);
  await historyRepo.upsert({ itemKey: `${id}:movie:1`, positionSec: 10, completed: false });
  await catalogRepo.putSearchIndex({ sourceId: id, data: '{}', builtAt: 1 });
  const db = await getDb();
  await db.epgPrograms.bulkPut([
    { channelEpgId: `epg-${id}`, start: 1, end: 2, sourceId: id, title: 'Show' },
    { channelEpgId: `epg-${id}`, start: 2, end: 3, sourceId: id, title: 'Show 2' },
  ]);
}

/** Counts the records of each table that belong to source `id`. */
async function countFor(id: string) {
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

describe('sourcesRepo', () => {
  it('put/get/list/update', async () => {
    await sourcesRepo.put(source('b', 20));
    await sourcesRepo.put(source('a', 10, { kind: 'm3u-file', secretRef: undefined }));
    expect((await sourcesRepo.list()).map((s) => s.id)).toEqual(['a', 'b']);
    expect(await sourcesRepo.update('a', { lastSyncStatus: 'ok', lastSyncAt: 5 })).toBe(true);
    expect(await sourcesRepo.get('a')).toMatchObject({ lastSyncStatus: 'ok', lastSyncAt: 5 });
    expect(await sourcesRepo.update('zzz', { name: 'x' })).toBe(false);
  });

  it('removing a source deletes every record with that sourceId and only those (CA4)', async () => {
    await seed('a');
    await seed('b');
    await settingsRepo.set('activeSourceId', 'a');
    await settingsRepo.set('lastChannelKey', 'a:live:1');
    await settingsRepo.set('theme', 'dark');

    const before = await countFor('a');
    expect(Object.values(before).every((n) => n > 0)).toBe(true);

    await sourcesRepo.remove('a');

    const after = await countFor('a');
    expect(after).toEqual(Object.fromEntries(Object.keys(before).map((k) => [k, 0])));
    expect(await countFor('b')).toEqual(before); // the other source stays intact
    expect(await settingsRepo.get('activeSourceId')).toBeUndefined();
    expect(await settingsRepo.get('lastChannelKey')).toBeUndefined();
    expect(await settingsRepo.get('theme')).toBe('dark');
  });

  it('does not clear settings pointing to another source', async () => {
    await seed('a');
    await settingsRepo.set('activeSourceId', 'b');
    await settingsRepo.set('lastChannelKey', 'b:live:1');
    await sourcesRepo.remove('a');
    expect(await settingsRepo.get('activeSourceId')).toBe('b');
    expect(await settingsRepo.get('lastChannelKey')).toBe('b:live:1');
  });

  it('removing a non-existent source does not fail', async () => {
    await expect(sourcesRepo.remove('does-not-exist')).resolves.toBeUndefined();
  });
});
