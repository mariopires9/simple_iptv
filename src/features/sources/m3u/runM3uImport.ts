// Runs the `syncM3u` worker task for a source (SRC-05 AC1), or `syncM3uFile` with a picked file
// (SRC-06). The worker module is loaded on demand so Comlink and the worker client stay out of the
// initial bundle. For a URL list only the source id is sent: the worker reads the list URL from the
// vault itself.
import { sourcesRepo, type Source } from '@/core/db';
import type { SyncM3uResult } from '@/providers/m3u';
import type { TaskProgress } from '@/worker';

export interface M3uImportOptions {
  signal?: AbortSignal;
  onProgress?: (p: TaskProgress) => void;
}

export type RunM3uImport = (sourceId: string, options: M3uImportOptions) => Promise<SyncM3uResult>;

export const runM3uImport: RunM3uImport = async (sourceId, options) => {
  const { runTask } = await import('@/worker');
  return runTask('syncM3u', { sourceId }, options);
};

/**
 * After a client-side cancel (which rejects at once), waits until the worker has really stopped
 * working on the source and returns its row, so the UI can report the actual outcome: an import
 * already in its (non-cancellable) write phase completes.
 */
export type SettleM3uImport = (sourceId: string) => Promise<Source | undefined>;

export const settleM3uImport: SettleM3uImport = async (sourceId) => {
  const { runTask } = await import('@/worker');
  await runTask('waitSyncIdle', { sourceId });
  return sourcesRepo.get(sourceId);
};

/** Runs the `syncM3uFile` worker task (SRC-06): the picked `File` is sent by structured clone. */
export type RunM3uFileImport = (
  sourceId: string,
  file: Blob,
  options: M3uImportOptions,
) => Promise<SyncM3uResult>;

export const runM3uFileImport: RunM3uFileImport = async (sourceId, file, options) => {
  const { runTask } = await import('@/worker');
  return runTask('syncM3uFile', { sourceId, file }, options);
};
