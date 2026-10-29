// Module features/sources — see docs/ARCHITECTURE.md §3.
// Statically imported by the router: export nothing that loads `@/core/db` eagerly.
export { sourcesRoutes, sourcesOnboardingRoutes } from './routes';
export {
  getSourcesPresenceSnapshot,
  getSourcesPresent,
  hasSources,
  invalidateSourcesPresence,
  setSourcesPresent,
  subscribeSourcesPresent,
} from './sourcesPresence';
export type { SourcesPresenceSnapshot } from './sourcesPresence';
// SRC-08: the active list (for the app shell) and the top-bar selector slot (lazy inside).
export {
  forgetActiveSource,
  getActiveSourceSnapshot,
  loadActiveSourceId,
  setActiveSource,
  subscribeActiveSource,
  useActiveSource,
  useActiveSourceChanges,
  useActiveSourceId,
} from './activeSource';
export type { ActiveSourceSnapshot } from './activeSource';
export { SourceSelectorSlot } from './SourceSelectorSlot';
