import Typography from '@mui/material/Typography';
import { useParams } from 'react-router';
import { t } from '@/i18n';

/** Placeholder (FND-04): movie grid, optionally filtered by category. */
export function MoviesScreen() {
  const { categoryId } = useParams();
  const text = t.routes.screens.movies;
  return (
    <>
      <Typography variant="h1">{text.title}</Typography>
      {categoryId !== undefined && (
        <Typography>
          {t.routes.category}: {categoryId}
        </Typography>
      )}
      <Typography color="text.secondary">{text.empty}</Typography>
    </>
  );
}
