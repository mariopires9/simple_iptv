import Typography from '@mui/material/Typography';
import { t } from '@/i18n';

/** Placeholder (FND-04): favorites. */
export function FavoritesScreen() {
  const text = t.routes.screens.favorites;
  return (
    <>
      <Typography variant="h1">{text.title}</Typography>
      <Typography color="text.secondary">{text.empty}</Typography>
    </>
  );
}
