// Data worker task registry — the worker's composition root (FND-07, ADR-009).
// Lives outside core because tasks use providers (core must not import them). Only data.worker.ts
// imports this module at runtime; the main thread imports it with `import type` (client.ts).
// How to add a task: see the header of src/core/worker/tasks.ts.
import { WorkerTaskError, type TaskContext, type TaskRegistry } from '@/core/worker';
import {
  syncXtreamSource,
  waitForSourceIdle,
  type SyncXtreamInput,
  type SyncXtreamResult,
} from '@/providers/xtream';

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

/** SRC-07: syncs an Xtream source's catalogue (the password is read from the vault in here). */
export function syncXtream(input: SyncXtreamInput, ctx: TaskContext): Promise<SyncXtreamResult> {
  return syncXtreamSource(input, ctx);
}

/**
 * Resolves once no sync of the source is running or queued in this worker (used after a
 * client-side abort, which rejects before the worker has actually stopped).
 */
export async function waitSyncIdle(input: { sourceId: string }, _ctx: TaskContext): Promise<void> {
  await waitForSourceIdle(input.sourceId);
}

export const tasks = {
  selfTest,
  syncXtream,
  waitSyncIdle,
} satisfies TaskRegistry;

export type Tasks = typeof tasks;
export type TaskName = keyof Tasks;
export type TaskInput<N extends TaskName> = Parameters<Tasks[N]>[0];
export type TaskOutput<N extends TaskName> = Awaited<ReturnType<Tasks[N]>>;
