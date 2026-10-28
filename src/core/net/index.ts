// core/net module — see docs/ARCHITECTURE.md §3. Network errors (FND-06); fetch helpers in later stories.
export { NetError, isNetError, shortenUrl } from './errors';
export type { NetErrorKind, NetErrorHint, NetErrorInit } from './errors';
export { MAX_EXTERNAL_URL_LENGTH, displayUrl, parseExternalUrl, safeExternalLink } from './url';
export type {
  ExternalUrlPurpose,
  ExternalUrlRejection,
  ExternalUrlResult,
  SafeExternalLink,
} from './url';
