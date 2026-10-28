// App-facing data worker client (main thread) — FND-07 (ADR-009).
// The registry is imported as a type only, so task code (providers, Valibot…) is bundled into
// the worker chunk and never into the main thread.
import { createWorkerClient } from '@/core/worker';
import type { Tasks } from './tasks';

const client = createWorkerClient<Tasks>(
  // The literal `new Worker(new URL(...), { type: 'module' })` pattern is what Vite recognises to
  // emit the worker as a separate chunk (FND-07 AC3).
  () =>
    new Worker(new URL('./data.worker.ts', import.meta.url), {
      type: 'module',
      name: 'data',
    }),
);

/** Returns the data worker's Comlink proxy, creating it on the first call. */
export const getDataWorker = client.getDataWorker;

/** Runs a task registered in ./tasks.ts on the data worker. */
export const runTask = client.runTask;

/** Terminates the worker (tests, cleanup). In-flight calls reject with kind 'failed'. */
export function terminateDataWorker(): void {
  client.terminate();
}
