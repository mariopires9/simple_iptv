import Typography from '@mui/material/Typography';
import { t } from '@/i18n';

/** Placeholder (FND-04): Home (continue watching, recent channels, favorites). */
export function HomeScreen() {
  const text = t.routes.screens.home;
  return (
    <>
      <Typography variant="h1">{text.title}</Typography>
      <Typography color="text.secondary">{text.empty}</Typography>
    </>
  );
}
