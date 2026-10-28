// Módulo core/worker — ver docs/ARCHITECTURE.md §3 e ADR-009 (FND-07).
// A thread principal usa só o cliente; data.worker.ts é carregado pelo próprio cliente.
export {
  getDataWorker,
  runTask,
  terminateDataWorker,
  type DataWorkerRemote,
  type RunTaskOptions,
} from './client';
export { WorkerTaskError, type WorkerTaskErrorKind } from './errors';
export type { TaskContext, TaskInput, TaskName, TaskOutput, TaskProgress } from './tasks';
