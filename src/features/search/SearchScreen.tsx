import Typography from '@mui/material/Typography';
import { t } from '@/i18n';

/** Placeholder (FND-04): global search. */
export function SearchScreen() {
  const text = t.routes.screens.search;
  return (
    <>
      <Typography variant="h1">{text.title}</Typography>
      <Typography color="text.secondary">{text.empty}</Typography>
    </>
  );
}
