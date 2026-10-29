// Add-M3U-URL screen (SRC-05): in the onboarding flow (full screen, back to the source types) and
// from My lists (inside the AppShell, back to My lists). A list the browser cannot download points
// to the local-file screen of the same flow (SRC-06).
import ArrowBack from '@mui/icons-material/ArrowBack';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { M3uUrlForm } from './m3u/M3uUrlForm';

function AddM3uUrl({
  backTo,
  doneTo,
  xtreamTo,
  fileTo,
}: {
  backTo: string;
  doneTo: string;
  xtreamTo: string;
  fileTo: string;
}) {
  const text = t.sources.addM3uUrl;
  return (
    <Box sx={{ maxWidth: 560, mx: 'auto' }}>
      <Button component={Link} to={backTo} startIcon={<ArrowBack />} sx={{ mb: 1, ml: -1 }}>
        {text.back}
      </Button>
      <Typography variant="h1" gutterBottom>
        {text.title}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {text.intro}
      </Typography>
      <M3uUrlForm doneTo={doneTo} xtreamTo={xtreamTo} fileTo={fileTo} />
    </Box>
  );
}

/** `/onboarding/m3u-url` (UX-01 → SRC-05): Home once imported. */
export function OnboardingM3uUrlScreen() {
  return (
    <AddM3uUrl
      backTo="/onboarding"
      doneTo="/"
      xtreamTo="/onboarding/xtream"
      fileTo="/onboarding/m3u-file"
    />
  );
}

/** `/settings/sources/add/m3u-url`: back to My lists once imported. */
export function AddM3uUrlScreen() {
  return (
    <AddM3uUrl
      backTo="/settings/sources"
      doneTo="/settings/sources"
      xtreamTo="/settings/sources/add/xtream"
      fileTo="/settings/sources/add/m3u-file"
    />
  );
}
