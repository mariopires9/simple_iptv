// Favoritos, histórico, definições e cofre (FND-05 CA2).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  it('add/has/remove/toggle e list por fonte+tipo (mais recentes primeiro)', async () => {
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

  it('rejeita chaves inválidas e chaves de categoria', async () => {
    await expect(favoritesRepo.add('invalida')).rejects.toThrow(TypeError);
    await expect(favoritesRepo.add('s1:live:cat:3')).rejects.toThrow(TypeError);
    await expect(favoritesRepo.toggle('s1:live:cat:3')).rejects.toThrow(TypeError);
  });

  it('sobrevive a uma re-sincronização do catálogo (chaves estáveis)', async () => {
    const data = {
      categories: [],
      items: [{ externalId: '7', name: 'Canal', streamPath: '7.ts' }],
    };
    await catalogRepo.replaceForSource('s1', 'live', data);
    await favoritesRepo.add('s1:live:7');
    await catalogRepo.replaceForSource('s1', 'live', data);
    const [fav] = await favoritesRepo.list('s1', 'live');
    expect(fav).toBeDefined();
    expect(await catalogRepo.get('live', fav!.itemKey)).toMatchObject({ name: 'Canal' });
  });
});

describe('historyRepo', () => {
  it('upsert cria e atualiza uma entrada por item', async () => {
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

  it('listRecent ordena por lastWatchedAt descendente, filtra fonte+tipo e respeita o limite', async () => {
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

  it('upsert parcial mantém os campos guardados e atualiza lastWatchedAt', async () => {
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

  it('entrada nova sem completed fica completed=false', async () => {
    expect((await historyRepo.upsert({ itemKey: 's1:movie:9' })).completed).toBe(false);
  });

  it('rejeita chaves de categoria', async () => {
    await expect(historyRepo.upsert({ itemKey: 's1:movie:cat:1' })).rejects.toThrow(TypeError);
  });

  it('guarda episodeKey e usa Date.now() por omissão', async () => {
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
});

describe('settingsRepo', () => {
  it('get/set/remove com valores tipados', async () => {
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
  it('guarda segredos cifrados e chaves; clear apaga tudo', async () => {
    await vaultStore.putSecret({
      ref: 'r1',
      iv: new Uint8Array([1, 2]),
      ciphertext: new ArrayBuffer(4),
    });
    await vaultStore.putKey({ id: 'device', key: {} as CryptoKey });
    const secret = await vaultStore.getSecret('r1');
    expect(Array.from(secret?.iv ?? [])).toEqual([1, 2]); // structured clone muda o realm
    expect(await vaultStore.getKey('device')).toBeDefined();
    await vaultStore.deleteSecret('r1');
    expect(await vaultStore.getSecret('r1')).toBeUndefined();
    await vaultStore.putSecret({
      ref: 'r2',
      iv: new Uint8Array(1),
      ciphertext: new ArrayBuffer(1),
    });
    await vaultStore.clear();
    expect(await vaultStore.getSecret('r2')).toBeUndefined();
    expect(await vaultStore.getKey('device')).toBeUndefined();
  });
});
