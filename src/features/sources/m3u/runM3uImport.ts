// Runs the `syncM3u` worker task for a source (SRC-05 AC1). The worker module is loaded on demand
// so Comlink and the worker client stay out of the initial bundle. Only the source id is sent: the
// worker reads the list URL from the vault itself.
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
