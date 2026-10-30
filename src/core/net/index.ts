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
  PROBE_COOLDOWN_MS,
  PROBE_TIMEOUT_MS,
  UNREACHABLE_PROBE_DELAYS_MS,
  connectivity,
  createConnectivityStore,
  createOriginProbe,
  isNetworkBlocked,
} from './connectivity';
export type {
  ConnectivityEnv,
  ConnectivityStatus,
  ConnectivityStore,
  ConnectivityStoreOptions,
  ReachabilityProbe,
} from './connectivity';
export {
  declaredMediaContainer,
  isDashStream,
  mediaContainerOfExtension,
  pathExtension,
} from './streamContainer';
export type { MediaContainer } from './streamContainer';
export { DEFAULT_TIMEOUT_MS, fetchJson, fetchStream, fetchText, identityRewriter } from './http';
export type {
  FetchImpl,
  FetchOptions,
  FetchStreamOptions,
  RequestPurpose,
  StreamBody,
  UrlRewriter,
} from './http';
// Personal proxy URL contract (PRX-01, ADR-010).
export {
  MAX_PROXY_BASE_URL_LENGTH,
  MAX_PROXY_TARGET_BYTES,
  PROXY_API_VERSION,
  PROXY_ERROR_HEADER,
  PROXY_SERVICE_NAME,
  createProxyRewriter,
  encodeBase64Url,
  isValidProxyToken,
  parseProxyBaseUrl,
  parseProxyHealth,
  proxyHealthUrl,
  proxyTargetName,
} from './proxy';
export type {
  ProxyBaseUrlRejection,
  ProxyBaseUrlResult,
  ProxyHealth,
  ProxyRewriterOptions,
} from './proxy';
