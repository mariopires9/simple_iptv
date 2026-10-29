// core/db module — IndexedDB persistence (Dexie), docs/ARCHITECTURE.md §5.
// Public API: typed repositories, types and helpers. Features never access `db.table()`.
export {
  openDatabase,
  closeDatabase,
  wipeAll,
  DatabaseUnavailableError,
  DatabaseClosedError,
  type DatabaseUnavailableReason,
  type OpenDatabaseOptions,
} from './database';
export { DB_NAME, DB_VERSION } from './schema';
export {
  itemKey,
  categoryKey,
  parseItemKey,
  parseCategoryKey,
  sourcePrefix,
  typePrefix,
  isContentType,
  normalizeName,
  tokenizeSearchText,
  isSearchableQuery,
  MIN_SEARCH_QUERY_LENGTH,
  episodeItemKey,
  episodeKeyPrefix,
  isEpisodeItemKey,
  type ParsedItemKey,
  type ParsedCategoryKey,
} from './keys';
export { sourcesRepo } from './repos/sources';
export {
  catalogRepo,
  onCatalogWrite,
  BULK_CHUNK_SIZE,
  type PageOptions,
  type CatalogReplacementByType,
  type ReplaceResult,
} from './repos/catalog';
export { favoritesRepo } from './repos/favorites';
export {
  historyRepo,
  type RecentItem,
  type RecentItemsOptions,
  type RecentItemsResult,
} from './repos/history';
export { settingsRepo } from './repos/settings';
export { vaultStore } from './repos/vault';
export * from './types';
