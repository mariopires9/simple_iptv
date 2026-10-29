// Module providers/xtream — see docs/ARCHITECTURE.md §3. Client and connection test (SRC-02),
// catalogue mapping and sync (SRC-07).
export {
  XTREAM_CATALOG_ACTIONS,
  mapCategories,
  mapLiveStreams,
  mapSeries,
  mapVodStreams,
  toExternalId,
  toYear,
} from './catalog';
export type { MapOptions, Mapped } from './catalog';
export {
  CATEGORIES_TIMEOUT_MS,
  ITEMS_TIMEOUT_MS,
  credentialFreeUrl,
  isSourceSyncing,
  syncXtreamSource,
  waitForSourceIdle,
} from './sync';
export type {
  SyncXtreamDeps,
  SyncXtreamInput,
  SyncXtreamResult,
  XtreamSyncErrorCode,
  XtreamSyncPhase,
} from './sync';
export { createXtreamClient } from './client';
export type { XtreamClient, XtreamClientOptions, XtreamParams } from './client';
export { InvalidServerUrlError, assertServerUrl, normalizeServerUrl } from './normalizeServerUrl';
export type { ServerUrlResult } from './normalizeServerUrl';
export { coerce, parseAuthResponse, toInt, toNumber } from './schemas';
export type { XtreamAccount, XtreamAuthInfo, XtreamServerInfo } from './schemas';
export { DEFAULT_PROBE_TIMEOUT_MS, testConnection } from './testConnection';
export type { TestConnectionOptions } from './testConnection';
export type {
  ConnectionAccount,
  ConnectionFixCode,
  ConnectionProblem,
  ConnectionProblemCode,
  ConnectionReport,
  HttpsAttempt,
  XtreamConnectionReport,
} from './types';
export { decodeBase64Utf8, fetchShortEpg, parseShortEpg } from './shortEpg';
export type { ShortEpgEncoding, ShortEpgProgramme } from './shortEpg';
export { fetchVodInfo, parseVodInfo } from './vodInfo';
export type { VodInfo } from './vodInfo';
