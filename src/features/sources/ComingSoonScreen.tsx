// Placeholder for the local M3U file source type offered by onboarding (SRC-06), on the shared
// placeholder pattern (`PlaceholderScreen`) plus a way back.
import Button from '@mui/material/Button';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { PlaceholderScreen } from '@/ui/PlaceholderScreen';

/** TODO(SRC-06): add a local M3U file. */
export function M3uFileComingSoonScreen() {
  const text = t.sources.comingSoon;
  return (
    <>
      <PlaceholderScreen title={text.m3uFile.title} message={text.m3uFile.message} />
      <Button variant="contained" component={Link} to="/onboarding" sx={{ mt: 3 }}>
        {text.back}
      </Button>
    </>
  );
}
