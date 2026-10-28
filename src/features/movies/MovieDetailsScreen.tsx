import Typography from '@mui/material/Typography';
import { useParams } from 'react-router';
import { t } from '@/i18n';

/** Placeholder (FND-04): movie details. */
export function MovieDetailsScreen() {
  const { movieId } = useParams();
  const text = t.routes.screens.movieDetails;
  return (
    <>
      <Typography variant="h1">{text.title}</Typography>
      {movieId !== undefined && (
        <Typography>
          {t.routes.item}: {movieId}
        </Typography>
      )}
      <Typography color="text.secondary">{text.empty}</Typography>
    </>
  );
}
