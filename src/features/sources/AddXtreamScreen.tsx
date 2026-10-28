// Add-Xtream screen (SRC-03): in the onboarding flow (full screen, back to the source types) and
// from My lists (inside the AppShell, back to My lists).
import ArrowBack from '@mui/icons-material/ArrowBack';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { XtreamSourceForm } from './xtream/XtreamSourceForm';

function AddXtream({ backTo }: { backTo: string }) {
  const text = t.sources.addXtream;
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
      <XtreamSourceForm />
    </Box>
  );
}

/** `/onboarding/xtream` (UX-01 → SRC-03). */
export function OnboardingXtreamScreen() {
  return <AddXtream backTo="/onboarding" />;
}

/** `/settings/sources/add/xtream`. */
export function AddXtreamScreen() {
  return <AddXtream backTo="/settings/sources" />;
}
