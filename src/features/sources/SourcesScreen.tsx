import Typography from '@mui/material/Typography';
import { t } from '@/i18n';

/** Placeholder (FND-04): "My lists" page (manage IPTV lists). */
export function SourcesScreen() {
  const text = t.routes.screens.sources;
  return (
    <>
      <Typography variant="h1">{text.title}</Typography>
      <Typography color="text.secondary">{text.empty}</Typography>
    </>
  );
}
