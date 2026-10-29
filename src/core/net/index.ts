// core/net module — see docs/ARCHITECTURE.md §3. Network errors (FND-06); fetch helpers (SRC-02).
export { NetError, isNetError, shortenUrl } from './errors';
export type { NetErrorKind, NetErrorHint, NetErrorInit } from './errors';
export { MAX_EXTERNAL_URL_LENGTH, displayUrl, parseExternalUrl, safeExternalLink } from './url';
export type {
  ExternalUrlPurpose,
  ExternalUrlRejection,
  ExternalUrlResult,
  SafeExternalLink,
} from './url';
export {
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_UNREACHABLE_RESET_MS,
  connectivity,
  createConnectivityStore,
  isNetworkBlocked,
} from './connectivity';
export type {
  ConnectivityEnv,
  ConnectivityStatus,
  ConnectivityStore,
  ConnectivityStoreOptions,
} from './connectivity';
export { DEFAULT_TIMEOUT_MS, fetchJson, fetchStream, fetchText, identityRewriter } from './http';
export type {
  FetchImpl,
  FetchOptions,
  FetchStreamOptions,
  RequestPurpose,
  StreamBody,
  UrlRewriter,
} from './http';
