// Pending work resumes when the connection returns (PWA-04 AC2): the scheduled catalogue refresh
// (SRC-07 AC5, `startBackgroundSyncIfDue`) skips every source while the device is offline, so the
// refreshes that became due meanwhile are started on the way back online. The worker module is
// loaded on demand only then (it stays out of the initial bundle).
import { log } from '@/core/log';
import { connectivity, type ConnectivityStore } from '@/core/net/connectivity';

/** Starts the due background syncs; resolves once they were dispatched. */
export type ResumeSync = () => Promise<unknown>;

const defaultResume: ResumeSync = async () => {
  const { startBackgroundSyncIfDue } = await import('@/worker');
  return startBackgroundSyncIfDue();
};

/**
 * Watches the connectivity store and runs `resume` on every transition back to `online`.
 * Returns the cleanup (unsubscribes).
 */
export function installResumeOnReconnect(
  store: ConnectivityStore = connectivity,
  resume: ResumeSync = defaultResume,
): () => void {
  let previous = store.getSnapshot();
  return store.subscribe(() => {
    const status = store.getSnapshot();
    const reconnected = previous !== 'online' && status === 'online';
    previous = status;
    if (!reconnected) return;
    log.info('Connection restored: resuming scheduled syncs');
    resume().catch((error: unknown) => {
      log.warn('Resuming scheduled syncs failed', { error });
    });
  });
}
