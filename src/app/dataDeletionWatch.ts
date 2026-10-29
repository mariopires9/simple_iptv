// SRC-10 in the other tabs: when a tab of this app deletes all data, every other tab locks its
// database (it must not recreate it nor write back what it still shows) and restarts on
// onboarding. Installed once by App. `@/core/db` is loaded on demand (not in the initial bundle).
import { appRestart, watchDataDeletion } from '@/core/session';

export interface DataDeletionWatchDeps {
  watch: (onDeleted: () => void) => () => void;
  lock: () => Promise<void>;
  restart: () => void;
}

const defaultDeps: DataDeletionWatchDeps = {
  watch: (onDeleted) => watchDataDeletion(onDeleted),
  lock: async () => {
    const { lockDatabase } = await import('@/core/db');
    await lockDatabase();
  },
  restart: () => appRestart.restartOnOnboarding(),
};

/** Starts listening; returns the stop function. */
export function installDataDeletionWatch(deps: Partial<DataDeletionWatchDeps> = {}): () => void {
  const { watch, lock, restart } = { ...defaultDeps, ...deps };
  return watch(() => {
    void lock()
      .catch(() => undefined)
      .finally(restart);
  });
}
