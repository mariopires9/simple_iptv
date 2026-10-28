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
