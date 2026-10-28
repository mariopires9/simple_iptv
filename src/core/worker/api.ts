// API exposed by the data worker via Comlink — FND-07 (ADR-009).
// Kept separate from data.worker.ts so it is testable without a real Worker (e.g. with MessageChannel).
//
// Errors: instead of letting Comlink serialize the exception (the default "throw" handler also
// sends `stack`), `run` never rejects — it returns an envelope `{ ok: false, error }` with only
// name/kind/message, and the client recreates the `WorkerTaskError`. This leaves the global
// `Comlink.transferHandlers` registry untouched and makes the boundary explicit in the return type.
//
// Progress: the client creates a MessageChannel, exposes the callback on one port and transfers the
// other; here that port is wrapped with `wrap`. Since the client owns the channel, it always closes
// it at the end (even if the worker dies or the input is not cloneable) and the port never dangles.

import { releaseProxy, wrap } from 'comlink';
import { WorkerTaskError, serializeTaskError, type SerializedTaskError } from './errors';
import { tasks as defaultTasks, type TaskContext, type TaskFn, type TaskProgress } from './tasks';

export type TaskResult<O = unknown> =
  { ok: true; value: O } | { ok: false; error: SerializedTaskError };

/** Progress callback, exposed by the client on the other end of `progressPort`. */
export type ProgressCallback = (p: TaskProgress) => void;

export interface DataWorkerApi {
  run(
    taskId: number,
    name: string,
    input: unknown,
    progressPort?: MessagePort,
  ): Promise<TaskResult>;
  cancel(taskId: number): void;
}

export interface DataWorkerApiOptions {
  /** Task registry; defaults to the one in tasks.ts (tests may inject another). */
  tasks?: Record<string, TaskFn>;
  /** Minimum interval between progress messages (ms). */
  throttleMs?: number;
  /** Maximum time to wait for the client to acknowledge the final progress (ms). */
  flushTimeoutMs?: number;
}

export const PROGRESS_THROTTLE_MS = 50;
export const PROGRESS_FLUSH_TIMEOUT_MS = 1000;

type RemoteProgress = (p: TaskProgress) => Promise<void>;

/** Sends progress at most once per `intervalMs`; the last pending value is always sent at the end. */
function createProgressSender(
  cb: RemoteProgress | undefined,
  intervalMs: number,
  flushTimeoutMs: number,
) {
  let last = -Infinity;
  let pending: TaskProgress | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = (p: TaskProgress) => {
    last = Date.now();
    pending = undefined;
    // Intermediate messages are "fire and forget": a failing callback does not interrupt the task.
    void Promise.resolve(cb?.(p)).catch(() => undefined);
  };

  return {
    push(p: TaskProgress) {
      if (!cb) return;
      const copy: TaskProgress = { phase: p.phase, done: p.done };
      if (p.total !== undefined) copy.total = p.total;
      const wait = last + intervalMs - Date.now();
      if (wait <= 0 && timer === undefined) {
        send(copy);
        return;
      }
      pending = copy;
      timer ??= setTimeout(
        () => {
          timer = undefined;
          if (pending) send(pending);
        },
        Math.max(0, wait),
      );
    },
    /**
     * Delivers the last pending progress and waits (at most `flushTimeoutMs`) for the client to
     * process it: the callback uses another channel and, without this wait, the final progress
     * could arrive after the response of `run`. The limit guarantees that `run` responds even if
     * the client has already closed the channel.
     */
    async flush() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const p = pending;
      pending = undefined;
      if (!cb || !p) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.resolve(cb(p)).catch(() => undefined),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, flushTimeoutMs);
        }),
      ]);
      clearTimeout(timeout);
    },
    discard() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}

export function createDataWorkerApi(options: DataWorkerApiOptions = {}): DataWorkerApi {
  const registry: Record<string, TaskFn> = options.tasks ?? defaultTasks;
  const throttleMs = options.throttleMs ?? PROGRESS_THROTTLE_MS;
  const flushTimeoutMs = options.flushTimeoutMs ?? PROGRESS_FLUSH_TIMEOUT_MS;
  const running = new Set<number>();
  const cancelled = new Set<number>();

  return {
    async run(taskId, name, input, progressPort) {
      running.add(taskId);
      const remote = progressPort ? wrap<RemoteProgress>(progressPort) : undefined;
      const sender = createProgressSender(remote, throttleMs, flushTimeoutMs);
      const ctx: TaskContext = {
        progress: (p) => sender.push(p),
        get cancelled() {
          return cancelled.has(taskId);
        },
        throwIfCancelled() {
          if (cancelled.has(taskId)) throw new WorkerTaskError('cancelled');
        },
      };
      try {
        const task = Object.hasOwn(registry, name) ? registry[name] : undefined;
        if (!task) throw new WorkerTaskError('failed', `Unknown task: ${name}`);
        ctx.throwIfCancelled();
        const value: unknown = await task(input, ctx);
        await sender.flush();
        return { ok: true, value };
      } catch (err) {
        // After a cancellation, any error (including an AbortError from an inner fetch)
        // is reported as 'cancelled' and not as a failure.
        if (cancelled.has(taskId) || isAbortError(err)) {
          sender.discard();
          return { ok: false, error: serializeTaskError(new WorkerTaskError('cancelled')) };
        }
        await sender.flush();
        return { ok: false, error: serializeTaskError(err) };
      } finally {
        running.delete(taskId);
        cancelled.delete(taskId);
        // The RELEASE is "fire and forget": if the client already closed the channel it gets no
        // reply, which is harmless (the port closes with the channel and the GC drops the promise).
        if (remote) remote[releaseProxy]();
      }
    },

    cancel(taskId) {
      // A cancellation arriving after the task has finished is ignored (ids do not accumulate).
      if (running.has(taskId)) cancelled.add(taskId);
    },
  };
}
