import Typography from '@mui/material/Typography';
import { t } from '@/i18n';

/** Placeholder (FND-04): settings. */
export function SettingsScreen() {
  const text = t.routes.screens.settings;
  return (
    <>
      <Typography variant="h1">{text.title}</Typography>
      <Typography color="text.secondary">{text.empty}</Typography>
    </>
  );
}
