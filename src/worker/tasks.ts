// Data worker task registry — the worker's composition root (FND-07, ADR-009).
// Lives outside core because tasks use providers (core must not import them). Only data.worker.ts
// imports this module at runtime; the main thread imports it with `import type` (client.ts).
// How to add a task: see the header of src/core/worker/tasks.ts.
import type { Source } from '@/core/db';
import type { UrlRewriter } from '@/core/net';
import { rewritersForSource } from '@/core/session';
import { WorkerTaskError, type TaskContext, type TaskRegistry } from '@/core/worker';
import {
  syncXtreamSource,
  waitForSourceIdle,
  type SyncXtreamInput,
  type SyncXtreamResult,
} from '@/providers/xtream';
import {
  syncM3uFileSource,
  syncM3uSource,
  waitForM3uSourceIdle,
  type SyncM3uFileInput,
  type SyncM3uInput,
  type SyncM3uResult,
} from '@/providers/m3u';
import {
  rebuildSearchIndexAfterSync,
  searchCatalog,
  warmUpSearch,
  type SearchQueryInput,
  type SearchQueryResult,
  type SearchWarmupResult,
} from './search/searchService';

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

/** PRX-01: a list's data requests (API, M3U download) follow its personal proxy routing. */
const dataRewriterFor = (source: Source): Promise<UrlRewriter> =>
  rewritersForSource(source).then((rewriters) => rewriters.data);

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

/**
 * SRC-07: syncs an Xtream source's catalogue (the password is read from the vault in here), then
 * queues its search index rebuild (SCH-01).
 */
export function syncXtream(input: SyncXtreamInput, ctx: TaskContext): Promise<SyncXtreamResult> {
  return syncXtreamSource(input, ctx, {
    afterSync: rebuildSearchIndexAfterSync,
    rewriterFor: dataRewriterFor,
  });
}

/**
 * SRC-04/SRC-05: downloads, parses and stores an M3U-URL source (the list URL is read from the
 * vault in here and never crosses postMessage), then queues its search index rebuild (SCH-01).
 */
export function syncM3u(input: SyncM3uInput, ctx: TaskContext): Promise<SyncM3uResult> {
  return syncM3uSource(input, ctx, {
    afterSync: rebuildSearchIndexAfterSync,
    rewriterFor: dataRewriterFor,
  });
}

/**
 * SRC-06: reads (`file.stream()`), parses and stores a local M3U file picked by the user (the
 * `File` arrives by structured clone; only the parsed catalogue is stored), then queues the
 * source's search index rebuild (SCH-01). Also its refresh, with a newly picked file.
 */
export function syncM3uFile(input: SyncM3uFileInput, ctx: TaskContext): Promise<SyncM3uResult> {
  return syncM3uFileSource(input, ctx, { afterSync: rebuildSearchIndexAfterSync });
}

/**
 * SCH-01: global search over the source's index (loaded from IndexedDB, or built if missing or
 * stale). Results grouped by type, at most `limit` per type.
 */
export function searchQuery(input: SearchQueryInput, ctx: TaskContext): Promise<SearchQueryResult> {
  ctx.throwIfCancelled();
  return searchCatalog(input);
}

/** SCH-01: loads the source's index into memory ahead of the first query (search screen open). */
export function searchWarmup(
  input: { sourceId: string },
  ctx: TaskContext,
): Promise<SearchWarmupResult> {
  ctx.throwIfCancelled();
  return warmUpSearch(typeof input?.sourceId === 'string' ? input.sourceId : '');
}

/**
 * Resolves once no sync of the source is running or queued in this worker (used after a
 * client-side abort, which rejects before the worker has actually stopped).
 */
export async function waitSyncIdle(input: { sourceId: string }, _ctx: TaskContext): Promise<void> {
  await Promise.all([waitForSourceIdle(input.sourceId), waitForM3uSourceIdle(input.sourceId)]);
}

export const tasks = {
  selfTest,
  syncXtream,
  syncM3u,
  syncM3uFile,
  waitSyncIdle,
  searchQuery,
  searchWarmup,
} satisfies TaskRegistry;

export type Tasks = typeof tasks;
export type TaskName = keyof Tasks;
export type TaskInput<N extends TaskName> = Parameters<Tasks[N]>[0];
export type TaskOutput<N extends TaskName> = Awaited<ReturnType<Tasks[N]>>;
