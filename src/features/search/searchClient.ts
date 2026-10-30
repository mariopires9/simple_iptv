// Global search calls to the data worker (SCH-01): queries never run on the main thread.
import type { ContentType } from '@/core/db';
import { runTask, type SearchQueryResult } from '@/worker';

export interface SearchRequest {
  sourceId: string;
  query: string;
  /** One type ("see all") or every type. */
  type?: ContentType;
  limit: number;
  /** Leave protected items (DRM/DASH, UX-07) out of hits and totals. */
  hideProtected?: boolean;
  /** Parental control (SEC-03): leave the items of these categories out of hits and totals. */
  excludeCategoryKeys?: readonly string[];
}

/** `runTask` throws synchronously when no worker can be created: always a rejected promise. */
function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return run();
  } catch (error) {
    return Promise.reject(error);
  }
}

export const searchClient = {
  query(request: SearchRequest, signal: AbortSignal): Promise<SearchQueryResult> {
    const input = {
      sourceId: request.sourceId,
      query: request.query,
      limit: request.limit,
      ...(request.hideProtected === true ? { hideProtected: true } : {}),
      ...(request.excludeCategoryKeys && request.excludeCategoryKeys.length > 0
        ? { excludeCategoryKeys: [...request.excludeCategoryKeys] }
        : {}),
      ...(request.type ? { types: [request.type] } : {}),
    };
    return call(() => runTask('searchQuery', input, { signal }));
  },

  /** Loads the index into the worker's memory before the first query (errors are ignored). */
  warmUp(sourceId: string): void {
    call(() => runTask('searchWarmup', { sourceId })).catch(() => undefined);
  },
};
