// Módulo core/db — persistência IndexedDB (Dexie), docs/ARCHITECTURE.md §5.
// API pública: repositórios tipados, tipos e helpers. As features nunca acedem a `db.table()`.
export {
  openDatabase,
  closeDatabase,
  wipeAll,
  DatabaseUnavailableError,
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
  type ParsedItemKey,
  type ParsedCategoryKey,
} from './keys';
export { sourcesRepo } from './repos/sources';
export {
  catalogRepo,
  BULK_CHUNK_SIZE,
  type PageOptions,
  type ReplaceResult,
} from './repos/catalog';
export { favoritesRepo } from './repos/favorites';
export { historyRepo } from './repos/history';
export { settingsRepo } from './repos/settings';
export { vaultStore } from './repos/vault';
export * from './types';
