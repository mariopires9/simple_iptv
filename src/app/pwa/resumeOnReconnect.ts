// Pending work resumes when the connection returns (PWA-04 AC2): the scheduled catalogue refresh
// (SRC-07 AC5) skips every list while the device is offline, so the refreshes that became due
// meanwhile are started on a real recovery — `offline` → `online` (browser) or `unreachable` →
// `online` confirmed by a probe or a request (see core/net/connectivity). At most one run per
// recovery, and never while the previous one is still being dispatched. The sync module is loaded
// on demand only then (it stays out of the initial bundle).
import { log } from '@/core/log';
import { connectivity, type ConnectivityStore } from '@/core/net/connectivity';

/** Starts the due background syncs; resolves once they were dispatched. */
export type ResumeSync = () => Promise<unknown>;

const defaultResume: ResumeSync = async () => {
  const { startDueSyncs } = await import('@/features/sources/dueSync');
  return startDueSyncs();
};

/** Runs `resume` once per recovery reported by the store. Returns the cleanup. */
export function installResumeOnReconnect(
  store: ConnectivityStore = connectivity,
  resume: ResumeSync = defaultResume,
): () => void {
  let running = false;
  return store.onRecovery(() => {
    if (running) return;
    running = true;
    log.info('Connection restored: resuming scheduled syncs');
    resume()
      .catch((error: unknown) => {
        log.warn('Resuming scheduled syncs failed', { error });
      })
      .finally(() => {
        running = false;
      });
  });
}
