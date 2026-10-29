// Module worker — the data worker's composition root (task registry + entry point + app client),
// FND-07/ADR-009. Features import from here; core/worker holds the generic machinery.
export { getDataWorker, runTask, terminateDataWorker } from './client';
export {
  DEFAULT_SYNC_MAX_AGE_MS,
  isSyncDue,
  startBackgroundSyncIfDue,
  type BackgroundSyncOptions,
  type BackgroundSyncOutcome,
  type BackgroundSyncResult,
} from './backgroundSync';
export { WorkerTaskError, type RunTaskOptions, type TaskProgress } from '@/core/worker';
export type { TaskInput, TaskName, TaskOutput } from './tasks';
export type {
  SearchGroup,
  SearchHit,
  SearchQueryInput,
  SearchQueryResult,
  SearchWarmupResult,
} from './search/searchService';
