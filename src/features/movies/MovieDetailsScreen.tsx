import { useParams } from 'react-router';
import { t } from '@/i18n';
import { PlaceholderScreen } from '@/ui/PlaceholderScreen';

/** Placeholder (FND-04): movie details. */
export function MovieDetailsScreen() {
  const { movieId } = useParams();
  const text = t.routes.screens.movieDetails;
  return (
    <PlaceholderScreen
      title={text.title}
      message={text.empty}
      detail={movieId === undefined ? undefined : t.routes.itemLabel(movieId)}
    />
  );
}
