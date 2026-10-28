// Start-up storage check (FND-05 AC5, FND-04): the app renders only after IndexedDB opened, or
// shows a full-screen message instead of a blank page.
import Button from '@mui/material/Button';
import { useEffect, useState } from 'react';
import type { DatabaseUnavailableReason } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { FullScreen, StatusView } from './routes/StatusView';

export type DatabaseCheck =
  | { status: 'checking' }
  | { status: 'ready' }
  | { status: 'unavailable'; reason: DatabaseUnavailableReason };

/**
 * One check at start-up, *before* the router mounts: a late failure (the open times out after
 * 10 s) can never tear down a screen the user is already using. `@/core/db` (Dexie) is imported
 * dynamically so it stays out of the initial chunk (ADR-003 budget).
 * Failures other than `DatabaseUnavailableError` are only logged: the app starts and the
 * repositories retry on their own.
 */
export function useDatabaseCheck(): DatabaseCheck {
  const [check, setCheck] = useState<DatabaseCheck>({ status: 'checking' });
  useEffect(() => {
    let active = true;
    const settle = (next: DatabaseCheck) => {
      if (active) setCheck(next);
    };
    import('@/core/db')
      .then(({ openDatabase, DatabaseUnavailableError }) =>
        openDatabase().then(
          () => settle({ status: 'ready' }),
          (error: unknown) => {
            if (error instanceof DatabaseUnavailableError) {
              log.error('Database unavailable at start-up', { reason: error.reason });
              settle({ status: 'unavailable', reason: error.reason });
            } else {
              log.warn('Database open did not complete at start-up', { error });
              settle({ status: 'ready' });
            }
          },
        ),
      )
      .catch((error: unknown) => {
        log.warn('Database module could not be loaded at start-up', { error });
        settle({ status: 'ready' });
      });
    return () => {
      active = false;
    };
  }, []);
  return check;
}

export function DatabaseUnavailableScreen({ reason }: { reason: DatabaseUnavailableReason }) {
  return (
    <FullScreen>
      <StatusView
        title={t.routes.dbUnavailable.title}
        message={t.db.errors[reason]}
        actions={
          <Button variant="contained" onClick={() => window.location.reload()}>
            {t.routes.dbUnavailable.reload}
          </Button>
        }
      />
    </FullScreen>
  );
}
