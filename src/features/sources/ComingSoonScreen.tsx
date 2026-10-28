// Placeholders for the M3U source types offered by onboarding (SRC-05 URL, SRC-06 local file).
import Button from '@mui/material/Button';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { StateView } from '@/ui/state';

function ComingSoon({ kind }: { kind: 'm3uUrl' | 'm3uFile' }) {
  const text = t.sources.comingSoon;
  return (
    <StateView
      variant="empty"
      headingLevel={1}
      title={text[kind].title}
      message={text[kind].message}
      actions={
        <Button variant="contained" component={Link} to="/onboarding">
          {text.back}
        </Button>
      }
    />
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
