// SRC-08 AC5: refresh runs the right worker task per list kind, with progress and cancellation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerTaskError } from '@/core/worker';
import {
  beginRemoval,
  cancelSourceSync,
  endRemoval,
  getSourceSyncSnapshot,
  isSourceSyncRunning,
  resetSourceSyncs,
  startSourceSync,
  type SyncWorker,
} from './sourceSync';

afterEach(() => {
  resetSourceSyncs();
});

interface Pending {
  name: string;
  options: {
    signal?: AbortSignal;
    onProgress?: (p: { phase: string; done: number; total?: number }) => void;
  };
  resolve: (value: { status: 'ok' | 'partial' | 'error' }) => void;
  reject: (error: unknown) => void;
}

/** A fake worker whose sync tasks stay pending until the test settles them. */
function fakeWorker() {
  const pending: Pending[] = [];
  const waitIdle = vi.fn(() => Promise.resolve());
  const runTask = vi.fn(
    (name: string, _input: { sourceId: string }, options: Pending['options'] = {}) => {
      if (name === 'waitSyncIdle') return waitIdle();
      return new Promise((resolve, reject) => {
        pending.push({ name, options, resolve, reject });
        options.signal?.addEventListener('abort', () => reject(new WorkerTaskError('cancelled')));
      });
    },
  );
  const worker = { runTask } as unknown as SyncWorker;
  return { worker: () => Promise.resolve(worker), runTask, pending, waitIdle };
}

describe('startSourceSync', () => {
  it.each([
    ['xtream', 'syncXtream'],
    ['m3u-url', 'syncM3u'],
  ] as const)('%s → %s, with progress, then the outcome', async (kind, task) => {
    const fake = fakeWorker();
    const run = await startSourceSync({ id: 's1', kind }, fake.worker);
    expect(run.dispatch).toBe('started');
    expect(fake.runTask).toHaveBeenCalledWith(task, { sourceId: 's1' }, expect.any(Object));
    expect(isSourceSyncRunning('s1')).toBe(true);

    fake.pending[0]?.options.onProgress?.({ phase: 'live', done: 40, total: 100 });
    expect(getSourceSyncSnapshot().get('s1')).toEqual({
      phase: 'live',
      done: 40,
      total: 100,
      cancelling: false,
    });

    fake.pending[0]?.resolve({ status: 'partial' });
    if (run.dispatch !== 'started') throw new Error('not started');
    await expect(run.done).resolves.toEqual({ status: 'partial' });
    expect(isSourceSyncRunning('s1')).toBe(false);
  });

  it('one sync per list: a second start while running → busy', async () => {
    const fake = fakeWorker();
    await startSourceSync({ id: 's1', kind: 'xtream' }, fake.worker);
    expect((await startSourceSync({ id: 's1', kind: 'xtream' }, fake.worker)).dispatch).toBe(
      'busy',
    );
    expect(fake.runTask).toHaveBeenCalledTimes(1);
  });

  it('a local M3U file cannot be refreshed without a new file (SRC-06 AC3)', async () => {
    const fake = fakeWorker();
    expect((await startSourceSync({ id: 'f', kind: 'm3u-file' }, fake.worker)).dispatch).toBe(
      'unsupported',
    );
    expect(fake.runTask).not.toHaveBeenCalled();
  });

  it('a local M3U file with a new file → syncM3uFile with that file, tracked like any sync', async () => {
    const fake = fakeWorker();
    const file = new File(['#EXTM3U\n'], 'new.m3u');
    const run = await startSourceSync({ id: 'f', kind: 'm3u-file' }, fake.worker, { file });
    expect(run.dispatch).toBe('started');
    expect(fake.runTask).toHaveBeenCalledWith(
      'syncM3uFile',
      { sourceId: 'f', file },
      expect.any(Object),
    );
    fake.pending[0]?.options.onProgress?.({ phase: 'read', done: 5, total: 8 });
    expect(getSourceSyncSnapshot().get('f')).toMatchObject({ phase: 'read', done: 5, total: 8 });
    fake.pending[0]?.resolve({ status: 'ok' });
    if (run.dispatch !== 'started') throw new Error('not started');
    await expect(run.done).resolves.toEqual({ status: 'ok' });
  });

  it('cancel: aborts, waits until the worker is idle, outcome "cancelled"', async () => {
    const fake = fakeWorker();
    const run = await startSourceSync({ id: 's1', kind: 'm3u-url' }, fake.worker);
    const cancelled = cancelSourceSync('s1');
    expect(getSourceSyncSnapshot().get('s1')?.cancelling).toBe(true);
    await cancelled;
    if (run.dispatch !== 'started') throw new Error('not started');
    await expect(run.done).resolves.toEqual({ status: 'cancelled' });
    expect(fake.waitIdle).toHaveBeenCalledTimes(1);
    expect(isSourceSyncRunning('s1')).toBe(false);
  });

  it('a failed task → "failed" with the error (never rejects)', async () => {
    const fake = fakeWorker();
    const run = await startSourceSync({ id: 's1', kind: 'xtream' }, fake.worker);
    const error = new WorkerTaskError('failed');
    fake.pending[0]?.reject(error);
    if (run.dispatch !== 'started') throw new Error('not started');
    await expect(run.done).resolves.toEqual({ status: 'failed', error });
  });

  // Review fix 3: a cancel while the worker module is still loading awaits the real end.
  it('cancel while the worker is still loading: no task is started, cancel awaits the end', async () => {
    const fake = fakeWorker();
    let release!: () => void;
    const loading = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = startSourceSync({ id: 's1', kind: 'xtream' }, async () => {
      await loading;
      return fake.worker();
    });
    expect(isSourceSyncRunning('s1')).toBe(true);
    let cancelDone = false;
    const cancelled = cancelSourceSync('s1').then(() => {
      cancelDone = true;
    });
    await Promise.resolve();
    expect(cancelDone).toBe(false);
    release();
    await cancelled;
    const run = await started;
    if (run.dispatch !== 'started') throw new Error('not started');
    await expect(run.done).resolves.toEqual({ status: 'cancelled' });
    expect(fake.runTask).not.toHaveBeenCalled();
    expect(isSourceSyncRunning('s1')).toBe(false);
  });

  // Review fix 2: a list being removed cannot start a sync; worker-side syncs are waited out.
  it('beginRemoval blocks new syncs, cancels the tracked one and waits for the worker', async () => {
    const fake = fakeWorker();
    const first = await startSourceSync({ id: 's1', kind: 'm3u-url' }, fake.worker);
    expect(first.dispatch).toBe('started');
    await beginRemoval('s1', fake.worker);
    expect(fake.pending[0]?.options.signal?.aborted).toBe(true);
    // Once for the cancelled tracked sync, once for any other sync of the list in the worker.
    expect(fake.waitIdle).toHaveBeenCalledTimes(2);
    expect((await startSourceSync({ id: 's1', kind: 'm3u-url' }, fake.worker)).dispatch).toBe(
      'removing',
    );
    endRemoval('s1');
    expect((await startSourceSync({ id: 's1', kind: 'm3u-url' }, fake.worker)).dispatch).toBe(
      'started',
    );
  });

  it('a worker that cannot be loaded → "unavailable", nothing left running', async () => {
    const error = new Error('chunk failed');
    const run = await startSourceSync({ id: 's1', kind: 'xtream' }, () => Promise.reject(error));
    expect(run).toEqual({ dispatch: 'unavailable', error });
    expect(isSourceSyncRunning('s1')).toBe(false);
  });
});
