// Add-local-M3U-file screen (SRC-06): in the onboarding flow (full screen, back to the source
// types) and from My lists (inside the AppShell, back to My lists).
import ArrowBack from '@mui/icons-material/ArrowBack';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { M3uFileForm } from './m3u/M3uFileForm';

function AddM3uFile({ backTo, doneTo }: { backTo: string; doneTo: string }) {
  const text = t.sources.addM3uFile;
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
      <M3uFileForm doneTo={doneTo} />
    </Box>
  );
}

/** `/onboarding/m3u-file` (UX-01 → SRC-06): Home once imported. */
export function OnboardingM3uFileScreen() {
  return <AddM3uFile backTo="/onboarding" doneTo="/" />;
}

/** `/settings/sources/add/m3u-file`: back to My lists once imported. */
export function AddM3uFileScreen() {
  return <AddM3uFile backTo="/settings/sources" doneTo="/settings/sources" />;
}
