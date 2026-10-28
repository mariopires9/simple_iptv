// Shown instead of the app when IndexedDB cannot be opened at start-up (FND-05 AC5, FND-04).
import Button from '@mui/material/Button';
import { useEffect, useState } from 'react';
import { DatabaseUnavailableError, openDatabase, type DatabaseUnavailableReason } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { FullScreen, StatusView } from './routes/StatusView';

/**
 * One check at start-up: opens the database and returns the reason when it is unavailable
 * (null while opening and once open). Other failures are only logged: the repositories retry.
 */
export function useDatabaseCheck(): DatabaseUnavailableReason | null {
  const [reason, setReason] = useState<DatabaseUnavailableReason | null>(null);
  useEffect(() => {
    let active = true;
    openDatabase().catch((error: unknown) => {
      if (error instanceof DatabaseUnavailableError) {
        log.error('Database unavailable at start-up', { reason: error.reason });
        if (active) setReason(error.reason);
      } else {
        log.warn('Database open did not complete at start-up', { error });
      }
    });
    return () => {
      active = false;
    };
  }, []);
  return reason;
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
