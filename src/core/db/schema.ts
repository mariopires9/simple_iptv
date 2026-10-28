// Dexie schema of the `simple-iptv` database — docs/ARCHITECTURE.md §5.
// Serialized file (docs/AGENT_WORKFLOW.md §5): every schema change is its own story
// and adds a new `version(n)` with `upgrade()`; never edit an already published version.
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

/** First field = primary key; the rest = indexes (`[a+b]` = compound index). */
export const SCHEMA_V1 = {
  sources: 'id, createdAt',
  secrets: 'ref',
  keys: 'id',
  categories: 'key, [sourceId+type], sourceId',
  channels: 'key, [categoryKey+order], sourceId, nameNorm',
  movies: 'key, [categoryKey+order], sourceId, addedAt',
  series: 'key, [categoryKey+order], sourceId',
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
