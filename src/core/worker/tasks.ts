// Data worker task registry — FND-07 (ADR-009).
//
// How to add a task (e.g. parseM3u, syncXtream, buildIndex):
//   1. Write `async function myTask(input: MyInput, ctx: TaskContext): Promise<MyOutput>`
//      (in its own file under src/core/worker/tasks/ if large). Input and output must be
//      structured-clone cloneable (no functions, classes or DOM).
//   2. Call `ctx.progress({ phase, done, total })` freely (sending is throttled to ~1/50 ms) and
//      `ctx.throwIfCancelled()` between units of work (e.g. after each batch of lines/items).
//   3. Register it in `tasks` below. The client is typed automatically:
//      `runTask('myTask', input, { onProgress, signal })`.
//   For the client to receive a useful message, throw `WorkerTaskError('failed', message)` —
//   without credentials or full URLs. Any other error arrives as kind 'failed' with a generic
//   message (the original message never crosses the boundary).

import { WorkerTaskError } from './errors';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry; the concrete types come from `tasks`
export type TaskFn<I = any, O = any> = (input: I, ctx: TaskContext) => Promise<O>;

export interface SelfTestInput {
  steps: number;
  /** Pause per step (ms). Even with 0 it yields the event loop so a cancel request can arrive. */
  delayMs?: number;
  /** Tests only: throws a `WorkerTaskError('failed')` on reaching this step. */
  failAt?: number;
}

export interface SelfTestOutput {
  steps: number;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Demo task: exercises progress, cancellation and error propagation. */
export async function selfTest(input: SelfTestInput, ctx: TaskContext): Promise<SelfTestOutput> {
  const steps = Math.max(0, Math.floor(input.steps));
  for (let i = 0; i < steps; i++) {
    ctx.throwIfCancelled();
    if (input.failAt === i) throw new WorkerTaskError('failed', `Simulated failure at step ${i}`);
    await pause(input.delayMs ?? 0);
    ctx.progress({ phase: 'selfTest', done: i + 1, total: steps });
  }
  ctx.throwIfCancelled();
  return { steps };
}

export const tasks = {
  selfTest,
} satisfies Record<string, TaskFn>;

export type TaskName = keyof typeof tasks;
export type TaskInput<N extends TaskName> = Parameters<(typeof tasks)[N]>[0];
export type TaskOutput<N extends TaskName> = Awaited<ReturnType<(typeof tasks)[N]>>;
