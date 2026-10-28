// Schema Dexie da base `simple-iptv` — docs/ARCHITECTURE.md §5.
// Ficheiro serializado (docs/AGENT_WORKFLOW.md §5): cada alteração de schema é uma story própria
// e acrescenta uma nova `version(n)` com `upgrade()`; nunca editar uma versão já publicada.
import { Dexie, type DexieOptions, type Table } from 'dexie';
import type {
  Category,
  Channel,
  EpgProgram,
  Favorite,
  HistoryEntry,
  KeyRecord,
  Movie,
  SearchIndexEntry,
  SecretRecord,
  Series,
  SeriesDetails,
  SettingsEntry,
  Source,
} from './types';

export const DB_NAME = 'simple-iptv';
export const DB_VERSION = 1;

/** Primeiro campo = chave primária; restantes = índices (`[a+b]` = índice composto). */
export const SCHEMA_V1 = {
  sources: 'id, createdAt',
  secrets: 'ref',
  keys: 'id',
  categories: 'key, [sourceId+type], sourceId',
  channels: 'key, [sourceId+categoryKey], sourceId, nameNorm',
  movies: 'key, [sourceId+categoryKey], sourceId, addedAt',
  series: 'key, [sourceId+categoryKey], sourceId',
  seriesDetails: 'seriesKey, fetchedAt',
  favorites: 'itemKey, [sourceId+type], addedAt',
  history: 'itemKey, [sourceId+type], lastWatchedAt',
  epgPrograms: '[channelEpgId+start], end, sourceId',
  settings: 'key',
  searchIndex: 'sourceId',
} as const;

export type TableName = keyof typeof SCHEMA_V1;

export class SimpleIptvDb extends Dexie {
  declare sources: Table<Source, string>;
  declare secrets: Table<SecretRecord, string>;
  declare keys: Table<KeyRecord, string>;
  declare categories: Table<Category, string>;
  declare channels: Table<Channel, string>;
  declare movies: Table<Movie, string>;
  declare series: Table<Series, string>;
  declare seriesDetails: Table<SeriesDetails, string>;
  declare favorites: Table<Favorite, string>;
  declare history: Table<HistoryEntry, string>;
  declare epgPrograms: Table<EpgProgram, [string, number]>;
  declare settings: Table<SettingsEntry, string>;
  declare searchIndex: Table<SearchIndexEntry, string>;

  constructor(options?: DexieOptions) {
    super(DB_NAME, options);
    this.version(DB_VERSION).stores(SCHEMA_V1);
  }
}
