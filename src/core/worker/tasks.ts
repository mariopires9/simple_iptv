// Data worker task contract — FND-07 (ADR-009). Generic: the registry itself lives in
// src/worker/tasks.ts (the worker's composition root), because tasks may use providers and core
// must not import them.
//
// How to add a task (e.g. parseM3u, syncXtream, buildIndex):
//   1. Write `async function myTask(input: MyInput, ctx: TaskContext): Promise<MyOutput>` in the
//      module that owns the logic (e.g. src/providers/…). Input and output must be
//      structured-clone cloneable (no functions, classes or DOM).
//   2. Call `ctx.progress({ phase, done, total })` freely (sending is throttled to ~1/50 ms) and
//      `ctx.throwIfCancelled()` between units of work (e.g. after each batch of lines/items).
//   3. Register it in `tasks` in src/worker/tasks.ts. The app client is typed automatically:
//      `runTask('myTask', input, { onProgress, signal })` from `@/worker`.
//   For the client to receive a useful message, throw `WorkerTaskError('failed', message)` —
//   without credentials or full URLs. Any other error arrives as kind 'failed' with a generic
//   message (the original message never crosses the boundary).

export interface TaskProgress {
  phase: string;
  done: number;
  total?: number;
}

/** Context each task receives inside the worker. */
export interface TaskContext {
  progress(p: TaskProgress): void;
  readonly cancelled: boolean;
  /** Throws `WorkerTaskError('cancelled')` if the client aborted the task. */
  throwIfCancelled(): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry; the concrete types come from the registry
export type TaskFn<I = any, O = any> = (input: I, ctx: TaskContext) => Promise<O>;

/** A task registry: name → task function. */
export type TaskRegistry = Record<string, TaskFn>;
