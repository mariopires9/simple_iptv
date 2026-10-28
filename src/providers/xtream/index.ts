// Module providers/xtream — see docs/ARCHITECTURE.md §3. Client and connection test (SRC-02),
// catalogue mapping and sync (SRC-07).
export {
  XTREAM_CATALOG_ACTIONS,
  mapCategories,
  mapLiveStreams,
  mapSeries,
  mapVodStreams,
  toExternalId,
  toNumber,
  toYear,
} from './catalog';
export type { MapOptions, Mapped } from './catalog';
export { SYNC_REQUEST_TIMEOUT_MS, credentialFreeUrl, syncXtreamSource } from './sync';
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
export { parseAuthResponse } from './schemas';
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
