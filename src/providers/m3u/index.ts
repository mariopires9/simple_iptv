// Module providers/m3u — see docs/ARCHITECTURE.md §3. Streaming M3U parser (SRC-04) and the
// import/refresh of M3U-by-URL sources (SRC-05). Only the data worker runs the sync.
export {
  M3U_SKIP_REASONS,
  MAX_ATTRIBUTE_LENGTH,
  MAX_LINE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_OPTIONS_PER_ENTRY,
  M3uParser,
  cleanText,
  containerFromUrl,
  feedM3uStream,
  parseM3uText,
  parseTagBody,
} from './parser';
export type {
  M3uAttributes,
  M3uEntry,
  M3uFirstLine,
  M3uHeader,
  M3uOption,
  M3uParseStats,
  M3uSkipReason,
  ParsedPlaylist,
  ParseStreamOptions,
} from './parser';
export {
  M3uCatalogBuilder,
  UNCATEGORIZED_CATEGORY_ID,
  UNCATEGORIZED_CATEGORY_NAME,
  entryBaseId,
  groupCategoryId,
  hash64,
  showSeriesId,
} from './catalog';
export type { M3uCatalog, M3uCatalogOptions } from './catalog';
export {
  DEFAULT_M3U_RULES,
  M3uClassifier,
  classifyEntry,
  classifyGroup,
  episodeMarker,
  strongEpisodeMarker,
} from './classify';
export type {
  ClassifyInput,
  ClassifyReason,
  Classification,
  EpisodeInfo,
  GroupKind,
  M3uClassificationRules,
} from './classify';
export { DOWNLOAD_INACTIVITY_TIMEOUT_MS, downloadM3u } from './download';
export type { DownloadOptions, DownloadResult } from './download';
export {
  MAX_BYTES,
  MAX_ENTRIES,
  isM3uSourceSyncing,
  listUrlSecrets,
  storableUrlCheck,
  syncM3uSource,
  waitForM3uSourceIdle,
} from './sync';
export type {
  M3uSyncErrorCode,
  M3uSyncPhase,
  M3uSyncProgress,
  SyncM3uDeps,
  SyncM3uInput,
  SyncM3uResult,
} from './sync';
export { detectXtreamPlaylistUrl } from './xtreamUrl';
export type { XtreamPlaylistCredentials } from './xtreamUrl';
