// Persistence layer (core/db) error messages — the UI turns `reason` into text.
import type { DatabaseUnavailableReason } from '@/core/db';

export const db = {
  errors: {
    unsupported:
      'This browser does not allow data to be stored on this device. If you are browsing privately, open the app in a normal window.',
    'open-failed':
      'Could not access the device storage. If you are browsing privately, open the app in a normal window or allow this site to store data.',
    timeout: 'The device storage did not respond. Close other tabs running the app and try again.',
  } satisfies Record<DatabaseUnavailableReason, string>,
};
