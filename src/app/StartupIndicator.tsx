// Start-up indicator (PWA-03 AC4): the database opens before any screen mounts, and opening it is
// where Dexie runs the schema upgrades of a new version. A quick open shows nothing (UX_UI §5);
// one that takes longer (typically a migration) shows this until it finishes.
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { t } from '@/i18n';
import { DelayedLoading } from '@/ui/state';
import { FullScreen } from './routes/FullScreen';

export function StartupIndicator() {
  return (
    <DelayedLoading>
      <FullScreen>
        <Stack role="status" spacing={2} sx={{ alignItems: 'center' }}>
          <CircularProgress aria-hidden size={32} />
          <Typography color="text.secondary">{t.app.startup.preparing}</Typography>
        </Stack>
      </FullScreen>
    </DelayedLoading>
  );
}
