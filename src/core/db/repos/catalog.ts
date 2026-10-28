// Repositório do catálogo: categorias, canais, filmes, séries, detalhes de séries e índice de pesquisa.
import { getDb } from '../database';
import { categoryKey, itemKey, normalizeName, parseCategoryKey, typePrefix } from '../keys';
import type { Table } from 'dexie';
import type { SimpleIptvDb } from '../schema';
import type {
  CatalogItemByType,
  CatalogReplacement,
  Category,
  ContentType,
  SearchIndexEntry,
  SeriesDetails,
} from '../types';

/** Tamanho de cada `bulkPut` dentro da transação (limita picos de memória). */
export const BULK_CHUNK_SIZE = 5_000;

type CatalogTableName = 'channels' | 'movies' | 'series';

const TABLE_BY_TYPE: Record<ContentType, CatalogTableName> = {
  live: 'channels',
  movie: 'movies',
  series: 'series',
};

/** Tabela do tipo pedido (uso interno de core/db; as features nunca chamam `db.table()`). */
function itemTable<T extends ContentType>(
  db: SimpleIptvDb,
  type: T,
): Table<CatalogItemByType[T], string> {
  return db.table<CatalogItemByType[T], string>(TABLE_BY_TYPE[type]);
}

export interface PageOptions {
  offset?: number;
  limit?: number;
}

export interface ReplaceResult {
  categories: number;
  items: number;
}

function byOrder(a: { order: number }, b: { order: number }): number {
  return a.order - b.order;
}

function buildItems<T extends ContentType>(
  sourceId: string,
  type: T,
  data: CatalogReplacement<T>,
): CatalogItemByType[T][] {
  return data.items.map((input, order) => {
    const { categoryExternalId, ...rest } = input;
    const record: Record<string, unknown> = {
      ...rest,
      key: itemKey(sourceId, type, input.externalId),
      sourceId,
      type,
      order,
    };
    if (categoryExternalId !== undefined && categoryExternalId !== '') {
      record.categoryKey = categoryKey(sourceId, type, categoryExternalId);
    }
    if (type === 'live') record.nameNorm = normalizeName(input.name);
    return record as unknown as CatalogItemByType[T];
  });
}

export const catalogRepo = {
  /**
   * Substitui todas as categorias e itens de uma fonte+tipo numa única transação:
   * ou fica tudo gravado ou nada muda. Outras fontes e outros tipos não são tocados.
   */
  async replaceForSource<T extends ContentType>(
    sourceId: string,
    type: T,
    data: CatalogReplacement<T>,
  ): Promise<ReplaceResult> {
    const categories: Category[] = data.categories.map((c, order) => ({
      key: categoryKey(sourceId, type, c.externalId),
      sourceId,
      type,
      externalId: c.externalId,
      name: c.name,
      order,
    }));
    const items = buildItems(sourceId, type, data);

    const db = await getDb();
    const table = itemTable(db, type);
    await db.transaction('rw', db.categories, table, async () => {
      // Apagar por intervalo da chave primária (prefixo `${sourceId}:${type}:`): o Dexie converte-o
      // num único `deleteRange` nativo, muito mais rápido do que percorrer um índice secundário.
      const prefix = typePrefix(sourceId, type);
      await db.categories.where('key').startsWith(prefix).delete();
      await table.where('key').startsWith(prefix).delete();
      await db.categories.bulkPut(categories);
      for (let i = 0; i < items.length; i += BULK_CHUNK_SIZE) {
        await table.bulkPut(items.slice(i, i + BULK_CHUNK_SIZE));
      }
    });
    return { categories: categories.length, items: items.length };
  },

  /** Categorias de uma fonte+tipo pela ordem original da fonte. */
  async listCategories(sourceId: string, type: ContentType): Promise<Category[]> {
    const db = await getDb();
    const list = await db.categories.where('[sourceId+type]').equals([sourceId, type]).toArray();
    return list.sort(byOrder);
  },

  /** Itens de uma categoria pela ordem original da fonte, com paginação opcional. */
  async listByCategory<T extends ContentType>(
    type: T,
    catKey: string,
    { offset = 0, limit }: PageOptions = {},
  ): Promise<CatalogItemByType[T][]> {
    const parsed = parseCategoryKey(catKey);
    if (!parsed || parsed.type !== type) return [];
    const db = await getDb();
    const list = await itemTable(db, type)
      .where('[sourceId+categoryKey]')
      .equals([parsed.sourceId, catKey])
      .toArray();
    list.sort(byOrder);
    return list.slice(offset, limit === undefined ? undefined : offset + limit);
  },

  /** Número de itens numa categoria. */
  async countByCategory(type: ContentType, catKey: string): Promise<number> {
    const parsed = parseCategoryKey(catKey);
    if (!parsed || parsed.type !== type) return 0;
    const db = await getDb();
    return itemTable(db, type)
      .where('[sourceId+categoryKey]')
      .equals([parsed.sourceId, catKey])
      .count();
  },

  /** Número de itens de uma fonte+tipo. */
  async count(sourceId: string, type: ContentType): Promise<number> {
    const db = await getDb();
    return itemTable(db, type).where('sourceId').equals(sourceId).count();
  },

  async get<T extends ContentType>(
    type: T,
    key: string,
  ): Promise<CatalogItemByType[T] | undefined> {
    const db = await getDb();
    return itemTable(db, type).get(key);
  },

  /** Vários itens por chave (ex.: favoritos); chaves inexistentes são omitidas, ordem preservada. */
  async getMany<T extends ContentType>(
    type: T,
    keys: readonly string[],
  ): Promise<CatalogItemByType[T][]> {
    const db = await getDb();
    const found = await itemTable(db, type).bulkGet([...keys]);
    return found.filter((x): x is CatalogItemByType[T] => x !== undefined);
  },

  async getCategory(key: string): Promise<Category | undefined> {
    const db = await getDb();
    return db.categories.get(key);
  },

  async getSeriesDetails(seriesKey: string): Promise<SeriesDetails | undefined> {
    const db = await getDb();
    return db.seriesDetails.get(seriesKey);
  },

  async putSeriesDetails(details: SeriesDetails): Promise<void> {
    const db = await getDb();
    await db.seriesDetails.put(details);
  },

  async getSearchIndex(sourceId: string): Promise<SearchIndexEntry | undefined> {
    const db = await getDb();
    return db.searchIndex.get(sourceId);
  },

  async putSearchIndex(entry: SearchIndexEntry): Promise<void> {
    const db = await getDb();
    await db.searchIndex.put(entry);
  },
};
