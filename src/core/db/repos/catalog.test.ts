import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, getDb } from '../database';
import { categoryKey, itemKey } from '../keys';
import { openFreshDatabase } from '../test-utils';
import type { CatalogItemInput, CategoryInput } from '../types';
import { catalogRepo } from './catalog';

beforeEach(async () => {
  await openFreshDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  closeDatabase();
});

const cats = (n: number, prefix = 'Cat'): CategoryInput[] =>
  Array.from({ length: n }, (_, i) => ({ externalId: String(i + 1), name: `${prefix} ${i + 1}` }));

function channels(n: number, catCount = 10, tag = ''): CatalogItemInput<'live'>[] {
  return Array.from({ length: n }, (_, i) => ({
    externalId: String(i + 1),
    categoryExternalId: String((i % catCount) + 1),
    name: `Canal ${tag}${i + 1}`,
    streamPath: `${i + 1}.ts`,
  }));
}

function movies(n: number): CatalogItemInput<'movie'>[] {
  return Array.from({ length: n }, (_, i) => ({
    externalId: String(i + 1),
    categoryExternalId: '1',
    name: `Filme ${i + 1}`,
    streamPath: `${i + 1}.mp4`,
  }));
}

describe('catalogRepo.replaceForSource (CA3)', () => {
  it('grava categorias e itens com chaves compostas, ordem e nome normalizado', async () => {
    const res = await catalogRepo.replaceForSource('s1', 'live', {
      categories: [
        { externalId: '9', name: 'Desporto' },
        { externalId: '3', name: 'Notícias' },
      ],
      items: [
        { externalId: '20', categoryExternalId: '3', name: 'RTP Notícias', streamPath: '20.ts' },
        { externalId: '10', categoryExternalId: '3', name: 'SIC', streamPath: '10.ts' },
        { externalId: '30', name: 'Sem categoria', streamPath: '30.ts' },
      ],
    });
    expect(res).toEqual({ categories: 2, items: 3 });

    const list = await catalogRepo.listCategories('s1', 'live');
    expect(list.map((c) => [c.key, c.name, c.order])).toEqual([
      ['s1:live:cat:9', 'Desporto', 0],
      ['s1:live:cat:3', 'Notícias', 1],
    ]);

    const ch = await catalogRepo.get('live', 's1:live:20');
    expect(ch).toMatchObject({
      key: 's1:live:20',
      sourceId: 's1',
      type: 'live',
      externalId: '20',
      categoryKey: 's1:live:cat:3',
      nameNorm: 'rtp noticias',
      order: 0,
    });
    expect(ch).not.toHaveProperty('categoryExternalId');
    expect(await catalogRepo.get('live', 's1:live:30')).not.toHaveProperty('categoryKey');
  });

  it('remove os itens antigos da fonte+tipo e não toca noutros tipos nem noutras fontes', async () => {
    await catalogRepo.replaceForSource('s1', 'live', {
      categories: cats(2),
      items: channels(50, 2),
    });
    await catalogRepo.replaceForSource('s1', 'movie', { categories: cats(1), items: movies(7) });
    await catalogRepo.replaceForSource('s2', 'live', {
      categories: cats(3),
      items: channels(40, 3),
    });

    await catalogRepo.replaceForSource('s1', 'live', {
      categories: cats(1, 'Nova'),
      items: channels(5, 1, 'v2-'),
    });

    expect(await catalogRepo.count('s1', 'live')).toBe(5);
    expect(await catalogRepo.get('live', itemKey('s1', 'live', 6))).toBeUndefined();
    expect((await catalogRepo.listCategories('s1', 'live')).map((c) => c.name)).toEqual(['Nova 1']);
    expect((await catalogRepo.get('live', 's1:live:1'))?.name).toBe('Canal v2-1');

    expect(await catalogRepo.count('s1', 'movie')).toBe(7);
    expect(await catalogRepo.listCategories('s1', 'movie')).toHaveLength(1);
    expect(await catalogRepo.count('s2', 'live')).toBe(40);
    expect(await catalogRepo.listCategories('s2', 'live')).toHaveLength(3);
  });

  it('uma falha a meio da transação deixa os dados antigos intactos', async () => {
    await catalogRepo.replaceForSource('s1', 'live', {
      categories: cats(2),
      items: channels(100, 2),
    });

    const db = await getDb();
    // O repositório usa a instância devolvida por `db.table()` (distinta de `db.channels` no Dexie).
    const table = db.table('channels');
    const original = table.bulkPut.bind(table);
    // Grava o lote (depois de as categorias e os itens antigos terem sido apagados) e só então falha.
    const spy = vi.spyOn(table, 'bulkPut').mockImplementation((...args) =>
      original(...(args as Parameters<typeof original>)).then(() => {
        throw new Error('falha simulada');
      }),
    );

    await expect(
      catalogRepo.replaceForSource('s1', 'live', {
        categories: cats(1, 'Nova'),
        items: channels(60, 1, 'v2-'),
      }),
    ).rejects.toThrow('falha simulada');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();

    expect(await catalogRepo.count('s1', 'live')).toBe(100);
    expect((await catalogRepo.get('live', 's1:live:1'))?.name).toBe('Canal 1');
    expect((await catalogRepo.listCategories('s1', 'live')).map((c) => c.name)).toEqual([
      'Cat 1',
      'Cat 2',
    ]);
  });

  it('substitui 100 000 itens numa única transação', async () => {
    const N = 100_000;
    const db = await getDb();
    const txSpy = vi.spyOn(db, 'transaction');

    await catalogRepo.replaceForSource('s1', 'live', {
      categories: cats(50),
      items: channels(N, 50),
    });
    await catalogRepo.replaceForSource('s2', 'live', {
      categories: cats(1),
      items: channels(3, 1),
    });
    txSpy.mockClear();

    const t0 = performance.now();
    const res = await catalogRepo.replaceForSource('s1', 'live', {
      categories: cats(50, 'Nova'),
      items: channels(N, 50, 'v2-'),
    });
    const ms = Math.round(performance.now() - t0);
    // Medição registada no relatório da story (fake-indexeddb em Node; não representa um browser).
    process.stdout.write(`[FND-05] replaceForSource 100k (fake-indexeddb): ${ms} ms\n`);

    expect(res).toEqual({ categories: 50, items: N });
    expect(txSpy).toHaveBeenCalledTimes(1);
    expect(await catalogRepo.count('s1', 'live')).toBe(N);
    expect((await catalogRepo.get('live', 's1:live:100000'))?.name).toBe('Canal v2-100000');
    expect(await catalogRepo.count('s2', 'live')).toBe(3);
  }, 60_000);
});

describe('catalogRepo — consultas', () => {
  beforeEach(async () => {
    await catalogRepo.replaceForSource('s1', 'live', {
      categories: cats(3),
      items: channels(30, 3),
    });
  });

  it('lista itens de uma categoria pela ordem original, com paginação', async () => {
    const cat = categoryKey('s1', 'live', 2);
    const all = await catalogRepo.listByCategory('live', cat);
    expect(all.map((c) => c.externalId)).toEqual([
      '2',
      '5',
      '8',
      '11',
      '14',
      '17',
      '20',
      '23',
      '26',
      '29',
    ]);
    const page = await catalogRepo.listByCategory('live', cat, { offset: 2, limit: 3 });
    expect(page.map((c) => c.externalId)).toEqual(['8', '11', '14']);
    expect(await catalogRepo.countByCategory('live', cat)).toBe(10);
  });

  it('chave de categoria inválida ou de outro tipo devolve vazio', async () => {
    expect(await catalogRepo.listByCategory('movie', categoryKey('s1', 'live', 2))).toEqual([]);
    expect(await catalogRepo.listByCategory('live', 'lixo')).toEqual([]);
    expect(await catalogRepo.countByCategory('live', 'lixo')).toBe(0);
  });

  it('getMany preserva a ordem e omite inexistentes', async () => {
    const list = await catalogRepo.getMany('live', ['s1:live:3', 's1:live:999', 's1:live:1']);
    expect(list.map((c) => c.externalId)).toEqual(['3', '1']);
  });

  it('getCategory, detalhes de séries e índice de pesquisa', async () => {
    expect((await catalogRepo.getCategory('s1:live:cat:1'))?.name).toBe('Cat 1');
    await catalogRepo.putSeriesDetails({
      seriesKey: 's1:series:7',
      sourceId: 's1',
      fetchedAt: 1,
      seasons: [{ number: 1, episodes: [] }],
    });
    expect((await catalogRepo.getSeriesDetails('s1:series:7'))?.seasons).toHaveLength(1);
    await catalogRepo.putSearchIndex({ sourceId: 's1', data: '{}', builtAt: 2 });
    expect((await catalogRepo.getSearchIndex('s1'))?.builtAt).toBe(2);
  });
});
