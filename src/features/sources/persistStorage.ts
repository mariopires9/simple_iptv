// PWA-05 AC1: when the first list is saved, ask the browser to keep the app's data
// (`navigator.storage.persist()`), so the lists and catalog are not evicted under storage pressure.
// Settings › Storage shows the outcome (it reads `persisted()` itself). Fire and forget: the
// answer never blocks or fails the save.
import { log } from '@/core/log';
import { requestPersistentStorage } from '@/core/platform';

/** Requests persistent storage in the background; the browser's answer is only logged. */
export function requestPersistentStorageForFirstList(): Promise<boolean | undefined> {
  return requestPersistentStorage().then((persisted) => {
    log.info('Persistent storage requested', { persisted: persisted ?? 'unsupported' });
    return persisted;
  });
}
