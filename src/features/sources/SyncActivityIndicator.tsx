// Discreet "updating lists" indicator next to the top-bar list selector (SRC-07 AC5): shown while
// any list sync tracked by `sourceSync` runs — the scheduled background refresh or a manual one —
// and links to "My lists", where each card shows its progress and can cancel it. Part of the lazy
// selector chunk (not the initial bundle).
import SyncRounded from '@mui/icons-material/SyncRounded';
import IconButton from '@mui/material/IconButton';
import { useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { getSourceSyncSnapshot, subscribeSourceSync } from './sourceSync';

const MY_LISTS_PATH = '/settings/sources';

export function SyncActivityIndicator() {
  const syncs = useSyncExternalStore(subscribeSourceSync, getSourceSyncSnapshot);
  if (syncs.size === 0) return null;
  const label = t.lists.selector.syncing;
  return (
    <IconButton
      component={Link}
      to={MY_LISTS_PATH}
      color="inherit"
      size="small"
      aria-label={label}
      title={label}
      data-testid="sync-activity"
    >
      <SyncRounded
        fontSize="small"
        sx={{
          '@keyframes sync-activity-spin': { to: { transform: 'rotate(-360deg)' } },
          animation: 'sync-activity-spin 1.6s linear infinite',
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      />
    </IconButton>
  );
}
