// core/worker module — see docs/ARCHITECTURE.md §3 and ADR-009 (FND-07).
// The main thread uses only the client; data.worker.ts is loaded by the client itself.
export {
  getDataWorker,
  runTask,
  terminateDataWorker,
  type DataWorkerRemote,
  type RunTaskOptions,
} from './client';
export { WorkerTaskError, type WorkerTaskErrorKind } from './errors';
export type { TaskContext, TaskInput, TaskName, TaskOutput, TaskProgress } from './tasks';
