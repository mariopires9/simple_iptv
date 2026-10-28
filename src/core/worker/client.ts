// Data worker client (main thread) — FND-07 (ADR-009).
// A single worker, created on first use; tasks share it and run interleaved.
//
// Cancellation: `AbortSignal` is not transferable, so each call gets a `taskId` and, on `abort`,
// the client calls `api.cancel(taskId)`; the task ends at its next `throwIfCancelled()`.
// The promise rejects immediately with kind 'cancelled' (same semantics as `fetch` with `signal`)
// and progress is no longer delivered, even if the worker still takes a while to stop.
//
// Worker failure: an `error`/`messageerror` event (or `terminateDataWorker()`) rejects every
// in-flight call with kind 'failed' and discards the singleton; the next call creates a new one.

import { expose, transfer, wrap, type Remote } from 'comlink';
import type { DataWorkerApi, TaskResult } from './api';
import { WorkerTaskError, deserializeTaskError } from './errors';
import type { TaskInput, TaskName, TaskOutput, TaskProgress } from './tasks';

export interface RunTaskOptions {
  onProgress?: (p: TaskProgress) => void;
  signal?: AbortSignal;
}

export type DataWorkerRemote = Remote<DataWorkerApi>;

interface Instance {
  worker: Worker;
  api: DataWorkerRemote;
  /** Aborted (with a WorkerTaskError as `reason`) when the worker dies or is terminated. */
  lifetime: AbortController;
}

let instance: Instance | undefined;
let nextTaskId = 1;

function ensureInstance(): Instance {
  if (instance) return instance;
  // The `new Worker(new URL(...), { type: 'module' })` pattern is what Vite recognises to
  // emit the worker as a separate chunk (FND-07 AC3).
  const worker = new Worker(new URL('./data.worker.ts', import.meta.url), {
    type: 'module',
    name: 'data',
  });
  const current: Instance = {
    worker,
    api: wrap<DataWorkerApi>(worker),
    lifetime: new AbortController(),
  };
  const onFailure = () => endInstance(current, 'The data worker failed');
  worker.addEventListener('error', onFailure);
  worker.addEventListener('messageerror', onFailure);
  instance = current;
  return current;
}

function endInstance(target: Instance, message: string): void {
  target.lifetime.abort(new WorkerTaskError('failed', message));
  target.worker.terminate();
  if (instance === target) instance = undefined;
}

/** Returns the data worker's Comlink proxy, creating it on the first call. */
export function getDataWorker(): DataWorkerRemote {
  return ensureInstance().api;
}

/** Terminates the worker (tests, cleanup). In-flight calls reject with kind 'failed'. */
export function terminateDataWorker(): void {
  if (instance) endInstance(instance, 'The data worker was terminated');
}

/** Runs a task registered in tasks.ts on the data worker. */
export function runTask<N extends TaskName>(
  name: N,
  input: TaskInput<N>,
  options: RunTaskOptions = {},
): Promise<TaskOutput<N>> {
  const { api, lifetime } = ensureInstance();
  return execute(api, name, input, options, lifetime.signal);
}

/** Variant with an explicit proxy — allows testing with a MessageChannel instead of a Worker. */
export function runTaskOn<N extends TaskName>(
  api: DataWorkerRemote,
  name: N,
  input: TaskInput<N>,
  options: RunTaskOptions = {},
): Promise<TaskOutput<N>> {
  return execute(api, name, input, options);
}

function transportError(err: unknown): WorkerTaskError {
  // Transport failure (e.g. non-cloneable input): do not forward details of the original error.
  return new WorkerTaskError(
    'failed',
    err instanceof Error && err.name === 'DataCloneError'
      ? 'Task data cannot be transferred to the worker'
      : 'Communication with the worker failed',
  );
}

async function execute<N extends TaskName>(
  api: DataWorkerRemote,
  name: N,
  input: TaskInput<N>,
  { onProgress, signal }: RunTaskOptions,
  lifetime?: AbortSignal,
): Promise<TaskOutput<N>> {
  if (signal?.aborted) throw new WorkerTaskError('cancelled');
  if (lifetime?.aborted) throw lifetimeError(lifetime);

  const taskId = nextTaskId++;
  let settled = false;

  // Dedicated progress channel: the client owns both ports and always closes it at the end.
  const channel = onProgress ? new MessageChannel() : undefined;
  if (channel && onProgress) {
    expose((p: TaskProgress) => {
      if (!settled && !signal?.aborted) onProgress(p);
    }, channel.port1);
  }

  let removeListeners = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    const onAbort = () => {
      api.cancel(taskId).catch(() => undefined);
      reject(new WorkerTaskError('cancelled'));
    };
    const onEnd = () => reject(lifetime ? lifetimeError(lifetime) : new WorkerTaskError('failed'));
    signal?.addEventListener('abort', onAbort, { once: true });
    lifetime?.addEventListener('abort', onEnd, { once: true });
    removeListeners = () => {
      signal?.removeEventListener('abort', onAbort);
      lifetime?.removeEventListener('abort', onEnd);
    };
  });

  const call = (async () => {
    try {
      return await api.run(
        taskId,
        name,
        input,
        channel ? transfer(channel.port2, [channel.port2]) : undefined,
      );
    } catch (err) {
      throw transportError(err);
    }
  })();
  // The loser of the race must not cause an "unhandled rejection".
  call.catch(() => undefined);
  interrupted.catch(() => undefined);

  try {
    const result: TaskResult = await Promise.race([call, interrupted]);
    // If the user aborted, 'cancelled' wins even if the task failed in the meantime.
    if (signal?.aborted) throw new WorkerTaskError('cancelled');
    if (!result.ok) throw deserializeTaskError(result.error);
    return result.value as TaskOutput<N>;
  } finally {
    settled = true;
    removeListeners();
    channel?.port1.close();
  }
}

function lifetimeError(lifetime: AbortSignal): WorkerTaskError {
  const reason: unknown = lifetime.reason;
  // New instance per call: each rejected promise gets its own error.
  return new WorkerTaskError(
    'failed',
    reason instanceof WorkerTaskError ? reason.message : undefined,
  );
}
