// App-facing data worker client (main thread) — FND-07 (ADR-009).
// The registry is imported as a type only, so task code (providers, Valibot…) is bundled into
// the worker chunk and never into the main thread.
//
// Master password (SEC-02): tasks that may read secrets wait while the vault is locked, then the
// worker receives the master key (if one is unlocked) before the task starts. When the vault
// locks, the worker is told to drop the key. `@/core/crypto/lockState` is Dexie-free.
import {
  getMasterKey,
  getMasterKeyGeneration,
  getVaultLockStatus,
  subscribeVaultLock,
  whenVaultUnlocked,
} from '@/core/crypto/lockState';
import {
  createWorkerClient,
  WorkerTaskError,
  type DataWorkerRemote,
  type RunTaskOptions,
} from '@/core/worker';
import type { TaskInput, TaskName, TaskOutput, Tasks } from './tasks';

const client = createWorkerClient<Tasks>(
  // The literal `new Worker(new URL(...), { type: 'module' })` pattern is what Vite recognises to
  // emit the worker as a separate chunk (FND-07 AC3).
  () =>
    new Worker(new URL('./data.worker.ts', import.meta.url), {
      type: 'module',
      name: 'data',
    }),
);

/** Tasks that never read the vault: they also run while locked. */
const VAULT_FREE_TASKS: ReadonlySet<TaskName> = new Set<TaskName>([
  'setVaultKey',
  'selfTest',
  'searchQuery',
  'searchWarmup',
  'waitSyncIdle',
]);

/** Worker instance and key generation the worker last received. */
let sent: { api: DataWorkerRemote; generation: number } | undefined;

async function syncWorkerKey(): Promise<void> {
  const api = client.getDataWorker();
  const generation = getMasterKeyGeneration();
  if (sent?.api === api && sent.generation === generation) return;
  const key = getMasterKey();
  // A new worker starts without a key: nothing to send unless one is unlocked.
  if (sent?.api !== api && !key) {
    sent = { api, generation };
    return;
  }
  await client.runTask('setVaultKey', key);
  sent = { api, generation };
}

// Locked (or turned off): a worker that holds a key drops it.
subscribeVaultLock(() => {
  if (getVaultLockStatus() === 'unlocked' || !sent) return;
  void syncWorkerKey().catch(() => undefined);
});

/** Returns the data worker's Comlink proxy, creating it on the first call. */
export const getDataWorker = client.getDataWorker;

/** Runs a task registered in ./tasks.ts on the data worker (after the unlock, see above). */
export async function runTask<N extends TaskName>(
  name: N,
  input: TaskInput<N>,
  options: RunTaskOptions = {},
): Promise<TaskOutput<N>> {
  if (!VAULT_FREE_TASKS.has(name)) {
    await whenVaultUnlocked(options.signal).catch(() => {
      throw new WorkerTaskError('cancelled');
    });
    await syncWorkerKey();
  }
  return client.runTask(name, input, options);
}

/** Terminates the worker (tests, cleanup). In-flight calls reject with kind 'failed'. */
export function terminateDataWorker(): void {
  client.terminate();
  sent = undefined;
}
