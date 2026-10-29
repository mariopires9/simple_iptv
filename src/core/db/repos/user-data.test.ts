// Favorites, history, settings and vault (FND-05 CA2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase } from '../database';
import { openFreshDatabase } from '../test-utils';
import { catalogRepo } from './catalog';
import { favoritesRepo } from './favorites';
import { historyRepo } from './history';
import { settingsRepo } from './settings';
import { vaultStore } from './vault';

beforeEach(async () => {
  await openFreshDatabase();
});

afterEach(async () => {
  await closeDatabase();
});

describe('favoritesRepo', () => {
  it('add/has/remove/toggle and list by source+type (most recent first)', async () => {
    await favoritesRepo.add('s1:live:1', 100);
    await favoritesRepo.add('s1:live:2', 200);
    await favoritesRepo.add('s1:movie:1', 300);
    await favoritesRepo.add('s2:live:1', 400);

    expect((await favoritesRepo.list('s1', 'live')).map((f) => f.itemKey)).toEqual([
      's1:live:2',
      's1:live:1',
    ]);
    expect(await favoritesRepo.has('s1:movie:1')).toBe(true);
    await favoritesRepo.remove('s1:movie:1');
    expect(await favoritesRepo.has('s1:movie:1')).toBe(false);

    expect(await favoritesRepo.toggle('s1:series:9')).toBe(true);
    expect(await favoritesRepo.list('s1', 'series')).toMatchObject([
      { itemKey: 's1:series:9', sourceId: 's1', type: 'series' },
    ]);
    expect(await favoritesRepo.toggle('s1:series:9')).toBe(false);
    expect(await favoritesRepo.has('s1:series:9')).toBe(false);
  });

  it('rejects invalid keys and category keys', async () => {
    await expect(favoritesRepo.add('invalid')).rejects.toThrow(TypeError);
    await expect(favoritesRepo.add('s1:live:cat:3')).rejects.toThrow(TypeError);
    await expect(favoritesRepo.toggle('s1:live:cat:3')).rejects.toThrow(TypeError);
  });

  it('survives a catalog re-sync (stable keys)', async () => {
    const data = {
      categories: [],
      items: [{ externalId: '7', name: 'Channel', streamPath: '7.ts' }],
    };
    await catalogRepo.replaceForSource('s1', 'live', data);
    await favoritesRepo.add('s1:live:7');
    await catalogRepo.replaceForSource('s1', 'live', data);
    const [fav] = await favoritesRepo.list('s1', 'live');
    expect(fav).toBeDefined();
    expect(await catalogRepo.get('live', fav!.itemKey)).toMatchObject({ name: 'Channel' });
  });
});

describe('historyRepo', () => {
  it('upsert creates and updates one entry per item', async () => {
    await historyRepo.upsert({
      itemKey: 's1:movie:1',
      positionSec: 10,
      durationSec: 100,
      completed: false,
      lastWatchedAt: 1,
    });
    const updated = await historyRepo.upsert({
      itemKey: 's1:movie:1',
      positionSec: 99,
      durationSec: 100,
      completed: true,
      lastWatchedAt: 2,
    });
    expect(updated).toEqual({
      itemKey: 's1:movie:1',
      sourceId: 's1',
      type: 'movie',
      positionSec: 99,
      durationSec: 100,
      completed: true,
      lastWatchedAt: 2,
    });
    expect(await historyRepo.get('s1:movie:1')).toEqual(updated);
  });

  it('listRecent sorts by descending lastWatchedAt, filters source+type and respects the limit', async () => {
    for (const [key, at] of [
      ['s1:movie:1', 10],
      ['s1:movie:2', 30],
      ['s1:movie:3', 20],
      ['s1:live:1', 50],
      ['s2:movie:1', 40],
    ] as const) {
      await historyRepo.upsert({ itemKey: key, completed: false, lastWatchedAt: at });
    }
    expect((await historyRepo.listRecent('s1', 'movie')).map((h) => h.itemKey)).toEqual([
      's1:movie:2',
      's1:movie:3',
      's1:movie:1',
    ]);
    expect((await historyRepo.listRecent('s1', 'movie', 2)).map((h) => h.itemKey)).toEqual([
      's1:movie:2',
      's1:movie:3',
    ]);
  });

  it('partial upsert keeps the stored fields and updates lastWatchedAt', async () => {
    await historyRepo.upsert({
      itemKey: 's1:series:5',
      positionSec: 120,
      durationSec: 2400,
      episodeKey: 's1:series:5:ep:3',
      completed: false,
      lastWatchedAt: 1,
    });
    const merged = await historyRepo.upsert({
      itemKey: 's1:series:5',
      positionSec: 300,
      lastWatchedAt: 2,
    });
    expect(merged).toEqual({
      itemKey: 's1:series:5',
      sourceId: 's1',
      type: 'series',
      positionSec: 300,
      durationSec: 2400,
      episodeKey: 's1:series:5:ep:3',
      completed: false,
      lastWatchedAt: 2,
    });
    const done = await historyRepo.upsert({ itemKey: 's1:series:5', completed: true });
    expect(done).toMatchObject({ positionSec: 300, durationSec: 2400, completed: true });
    expect(done.lastWatchedAt).toBeGreaterThan(2);
    expect(await historyRepo.get('s1:series:5')).toEqual(done);
  });

  it('a new entry without completed gets completed=false', async () => {
    expect((await historyRepo.upsert({ itemKey: 's1:movie:9' })).completed).toBe(false);
  });

  it('rejects category keys', async () => {
    await expect(historyRepo.upsert({ itemKey: 's1:movie:cat:1' })).rejects.toThrow(TypeError);
  });

  it('stores episodeKey and defaults to Date.now()', async () => {
    const before = Date.now();
    const e = await historyRepo.upsert({
      itemKey: 's1:series:5',
      episodeKey: 's1:series:5:ep:12',
      completed: false,
    });
    expect(e.episodeKey).toBe('s1:series:5:ep:12');
    expect(e.lastWatchedAt).toBeGreaterThanOrEqual(before);
    expect(e).not.toHaveProperty('positionSec');
    await historyRepo.remove('s1:series:5');
    expect(await historyRepo.get('s1:series:5')).toBeUndefined();
  });

  it('listRecentPage pages a source+types by descending lastWatchedAt', async () => {
    for (const [key, at] of [
      ['s1:movie:1', 10],
      ['s1:series:1', 30],
      ['s1:live:1', 40],
      ['s1:movie:2', 20],
      ['s2:movie:9', 50],
    ] as const) {
      await historyRepo.upsert({ itemKey: key, lastWatchedAt: at });
    }
    const keys = async (offset: number, limit: number) =>
      (await historyRepo.listRecentPage('s1', ['movie', 'series'], offset, limit)).map(
        (h) => h.itemKey,
      );
    expect(await keys(0, 2)).toEqual(['s1:series:1', 's1:movie:2']);
    expect(await keys(2, 2)).toEqual(['s1:movie:1']);
    expect(await keys(3, 2)).toEqual([]);
  });

  describe('listRecentItems (FAV-02)', () => {
    async function seedChannels(count: number) {
      await catalogRepo.replaceForSource('s1', 'live', {
        categories: [],
        items: Array.from({ length: count }, (_, i) => ({
          externalId: String(i + 1),
          name: `C${i + 1}`,
          streamPath: '',
        })),
      });
    }

    it('reads page by page until the limit of available items, skipping missing ones', async () => {
      await seedChannels(5);
      // Newest: 12 channels that left the list, then the 5 available ones.
      for (let i = 1; i <= 12; i++) {
        await historyRepo.upsert({ itemKey: `s1:live:gone${i}`, lastWatchedAt: 100 + i });
      }
      for (let i = 1; i <= 5; i++) {
        await historyRepo.upsert({ itemKey: `s1:live:${i}`, lastWatchedAt: i });
      }
      const page = vi.spyOn(historyRepo, 'listRecentPage');
      const result = await historyRepo.listRecentItems('s1', ['live'], { limit: 3, pageSize: 5 });
      expect(result.items.map((r) => r.item.name)).toEqual(['C5', 'C4', 'C3']);
      expect(result.scanned).toBe(15);
      expect(page).toHaveBeenCalledTimes(3);
    });

    it('applies accept, and stops at maxScanned', async () => {
      await seedChannels(5);
      for (let i = 1; i <= 5; i++) {
        await historyRepo.upsert({ itemKey: `s1:live:${i}`, lastWatchedAt: i });
      }
      const odd = await historyRepo.listRecentItems('s1', ['live'], {
        limit: 10,
        accept: (e) => Number(e.itemKey.split(':')[2]) % 2 === 1,
      });
      expect(odd.items.map((r) => r.item.name)).toEqual(['C5', 'C3', 'C1']);
      const bounded = await historyRepo.listRecentItems('s1', ['live'], {
        limit: 10,
        pageSize: 2,
        maxScanned: 3,
      });
      expect(bounded.items.map((r) => r.item.name)).toEqual(['C5', 'C4', 'C3']);
      expect(bounded.scanned).toBe(3);
    });

    it('scanned is 0 without history', async () => {
      expect(await historyRepo.listRecentItems('s1', ['live'], { limit: 3 })).toEqual({
        items: [],
        scanned: 0,
      });
    });
  });

  it('clearSource removes every type of that source only, and keeps the favorites (FAV-02 AC3)', async () => {
    for (const key of ['s1:live:1', 's1:movie:1', 's1:series:1', 's2:live:1']) {
      await historyRepo.upsert({ itemKey: key });
    }
    await favoritesRepo.add('s1:live:1');
    expect(await historyRepo.clearSource('s1')).toBe(3);
    for (const type of ['live', 'movie', 'series'] as const) {
      expect(await historyRepo.listRecent('s1', type)).toEqual([]);
    }
    expect(await historyRepo.get('s2:live:1')).toBeDefined();
    expect(await favoritesRepo.has('s1:live:1')).toBe(true);
  });
});

describe('settingsRepo', () => {
  it('get/set/remove with typed values', async () => {
    expect(await settingsRepo.get('onboardingDone')).toBeUndefined();
    await settingsRepo.set('onboardingDone', true);
    await settingsRepo.set('theme', 'light');
    const done: boolean | undefined = await settingsRepo.get('onboardingDone');
    expect(done).toBe(true);
    expect(await settingsRepo.get('theme')).toBe('light');
    await settingsRepo.remove('theme');
    expect(await settingsRepo.get('theme')).toBeUndefined();
  });
});

describe('vaultStore', () => {
  it('stores encrypted secrets and keys; clear deletes everything', async () => {
    await vaultStore.putSecret({
      ref: 'r1',
      kid: 'kid-test',
      iv: new Uint8Array([1, 2]),
      ciphertext: new ArrayBuffer(4),
    });
    await vaultStore.putKeyIfAbsent({ id: 'device', kid: 'kid-test', key: {} as CryptoKey });
    const secret = await vaultStore.getSecret('r1');
    expect(Array.from(secret?.iv ?? [])).toEqual([1, 2]); // structured clone changes the realm
    expect(await vaultStore.getKey('device')).toBeDefined();
    await vaultStore.deleteSecret('r1');
    expect(await vaultStore.getSecret('r1')).toBeUndefined();
    await vaultStore.putSecret({
      ref: 'r2',
      kid: 'kid-test',
      iv: new Uint8Array(1),
      ciphertext: new ArrayBuffer(1),
    });
    await vaultStore.clear();
    expect(await vaultStore.getSecret('r2')).toBeUndefined();
    expect(await vaultStore.getKey('device')).toBeUndefined();
  });
});
