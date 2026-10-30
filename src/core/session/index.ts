// Module core/session — state of the current session shared by every feature (SRC-08):
// framework-agnostic stores; the UI subscribes with `useSyncExternalStore`.
export {
  forgetActiveSource,
  getActiveSourceSnapshot,
  loadActiveSource,
  refreshActiveSource,
  setActiveSource,
  subscribeActiveSource,
  type ActiveSourceSnapshot,
} from './activeSource';
// Player open in this tab (PWA-03): app updates wait until it closes.
export {
  claimPlayback,
  isPlaybackActive,
  resetPlaybackForTests,
  subscribePlayback,
} from './playback';
// "Delete all data" across tabs and the restart on onboarding (SRC-10).
export {
  announceDataDeleted,
  appRestart,
  DATA_DELETED_MESSAGE,
  dataDeletionChannelName,
  watchDataDeletion,
} from './dataDeletion';
// Personal proxy configuration and per-list rewriters (PRX-01, ADR-010).
export {
  InvalidProxyConfigError,
  loadPersonalProxy,
  PROXY_ROUTINGS,
  PROXY_TOKEN_REF,
  proxyRoutingOf,
  removePersonalProxy,
  rewritersForSource,
  savePersonalProxy,
  type PersonalProxyConfig,
  type RewritersDeps,
  type SourceRewriters,
} from './proxy';
// Lists imported from a backup, waiting for their first sync after the restart (EXP-01).
export { markSourcesForSync, PENDING_SYNC_KEY, takeSourcesPendingSync } from './pendingSync';
