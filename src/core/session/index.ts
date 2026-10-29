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
