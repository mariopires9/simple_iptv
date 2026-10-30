// SEC-02: data worker tasks that read secrets wait for the unlock; the worker gets the master key
// before them and loses it on lock.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetVaultLock, setMasterKey, setVaultLocked } from '@/core/crypto/lockState';

const calls: { name: string; input: unknown }[] = [];
const api = {};

vi.mock('@/core/worker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/worker')>();
  return {
    ...actual,
    createWorkerClient: () => ({
      getDataWorker: () => api,
      runTask: (name: string, input: unknown) => {
        calls.push({ name, input });
        return Promise.resolve(undefined);
      },
      terminate: () => undefined,
    }),
  };
});

const { runTask, terminateDataWorker } = await import('./client');

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

afterEach(() => {
  calls.length = 0;
  terminateDataWorker();
  resetVaultLock();
});

describe('worker client and the master password lock', () => {
  it('a sync waits while locked, then runs after the key was sent', async () => {
    setVaultLocked();
    const pending = runTask('syncXtream', { sourceId: 's1' });
    await settle();
    expect(calls).toEqual([]);

    const key = { kid: 'master:test', key: {} as CryptoKey };
    setMasterKey(key);
    await pending;
    expect(calls.map((c) => c.name)).toEqual(['setVaultKey', 'syncXtream']);
    expect(calls[0]?.input).toBe(key);

    // Locking tells the worker to drop the key.
    setVaultLocked();
    await settle();
    expect(calls.at(-1)).toEqual({ name: 'setVaultKey', input: null });
  });

  it('search runs while locked; an aborted wait rejects as cancelled', async () => {
    setVaultLocked();
    await runTask('searchQuery', { sourceId: 's1', query: 'news', limit: 5 } as never);
    expect(calls.map((c) => c.name)).toEqual(['searchQuery']);

    const controller = new AbortController();
    const pending = runTask('syncM3u', { sourceId: 's1' } as never, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  });
});
