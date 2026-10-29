// Persistent "No connection" banner (PWA-04 AC1/AC2, docs/UX_UI.md §5): shown while the browser
// reports no network or the last requests failed for lack of one; gone as soon as the connection
// returns. Part of the initial bundle (top bar and full-screen layout): keep it tiny.
import CloudOffOutlined from '@mui/icons-material/CloudOffOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { connectivity, type ConnectivityStore } from '@/core/net/connectivity';
import { t } from '@/i18n';
import { useConnectivity } from './useConnectivity';

export interface ConnectionBannerProps {
  /** Tests inject their own store. */
  store?: ConnectivityStore;
}

export function ConnectionBanner({ store = connectivity }: ConnectionBannerProps) {
  const status = useConnectivity(store);
  const text = t.state.connection;
  return (
    // The live region stays mounted so the change is announced when the banner appears.
    <Box role="status" data-testid="connection-banner-region">
      {status !== 'online' && (
        <Box
          data-testid="connection-banner"
          data-status={status}
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
            px: 2,
            py: 0.75,
            bgcolor: 'warning.main',
            color: 'warning.contrastText',
          }}
        >
          <CloudOffOutlined aria-hidden fontSize="small" />
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
            {status === 'offline' ? text.offline : text.unreachable}
          </Typography>
          {status === 'unreachable' && (
            <Button size="small" color="inherit" onClick={() => store.retry()}>
              {text.retry}
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}
