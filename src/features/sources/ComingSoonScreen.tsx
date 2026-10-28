// Placeholders for the M3U source types offered by onboarding (SRC-05 URL, SRC-06 local file),
// on the shared placeholder pattern (`PlaceholderScreen`) plus a way back.
import Button from '@mui/material/Button';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { PlaceholderScreen } from '@/ui/PlaceholderScreen';

function ComingSoon({ kind }: { kind: 'm3uUrl' | 'm3uFile' }) {
  const text = t.sources.comingSoon;
  return (
    <>
      <PlaceholderScreen title={text[kind].title} message={text[kind].message} />
      <Button variant="contained" component={Link} to="/onboarding" sx={{ mt: 3 }}>
        {text.back}
      </Button>
    </>
  );
}

/** TODO(SRC-05): add an M3U list by URL. */
export function M3uUrlComingSoonScreen() {
  return <ComingSoon kind="m3uUrl" />;
}

/** TODO(SRC-06): add a local M3U file. */
export function M3uFileComingSoonScreen() {
  return <ComingSoon kind="m3uFile" />;
}
