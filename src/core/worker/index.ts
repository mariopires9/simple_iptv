// core/worker module — see docs/ARCHITECTURE.md §3 and ADR-009 (FND-07).
// Generic worker machinery: Comlink API (progress throttling, cancellation, error envelope) and a
// client parameterised by a worker factory. The app's registry and entry point live in src/worker.
export { createDataWorkerApi, type DataWorkerApi, type DataWorkerApiOptions } from './api';
export {
  createWorkerClient,
  runTaskOn,
  type DataWorkerRemote,
  type RunTaskOptions,
  type TaskInputOf,
  type TaskNameOf,
  type TaskOutputOf,
  type WorkerClient,
  type WorkerFactory,
} from './client';
export { WorkerTaskError, type WorkerTaskErrorKind } from './errors';
export type { TaskContext, TaskFn, TaskProgress, TaskRegistry } from './tasks';
