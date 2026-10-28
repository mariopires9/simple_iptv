// Add-Xtream screen (SRC-03): in the onboarding flow (full screen, back to the source types) and
// from My lists (inside the AppShell, back to My lists).
import ArrowBack from '@mui/icons-material/ArrowBack';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { t } from '@/i18n';
import { clearXtreamPrefill, readXtreamPrefill } from './xtream/prefill';
import { XtreamSourceForm } from './xtream/XtreamSourceForm';

function AddXtream({ backTo, doneTo }: { backTo: string; doneTo: string }) {
  const text = t.sources.addXtream;
  // Values handed over by the M3U-URL screen (in memory; router state only holds an opaque id).
  const { state } = useLocation();
  const [prefill] = useState(() => readXtreamPrefill(state));
  useEffect(() => () => clearXtreamPrefill(state), [state]);
  return (
    <Box sx={{ maxWidth: 560, mx: 'auto' }}>
      <Button component={Link} to={backTo} startIcon={<ArrowBack />} sx={{ mb: 1, ml: -1 }}>
        {text.back}
      </Button>
      <Typography variant="h1" gutterBottom>
        {text.title}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: prefill ? 1 : 3 }}>
        {text.intro}
      </Typography>
      {prefill && (
        <Typography color="text.secondary" sx={{ mb: 3 }} data-testid="xtream-prefilled">
          {text.prefilled}
        </Typography>
      )}
      <XtreamSourceForm doneTo={doneTo} initialValues={prefill} />
    </Box>
  );
}

/** `/onboarding/xtream` (UX-01 → SRC-03): Home once saved. */
export function OnboardingXtreamScreen() {
  return <AddXtream backTo="/onboarding" doneTo="/" />;
}

/** `/settings/sources/add/xtream`: back to My lists once saved. */
export function AddXtreamScreen() {
  return <AddXtream backTo="/settings/sources" doneTo="/settings/sources" />;
}
