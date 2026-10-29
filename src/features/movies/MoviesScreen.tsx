// Movies screen (VOD-01): categories, sort and the virtualised poster grid — the shared poster-grid
// screen (`@/ui/catalog/PosterGridScreen`) with the Movies strings, routes and fields.
import { catalogRepo, type Movie } from '@/core/db';
import { t } from '@/i18n';
import { PosterGridScreen } from '@/ui/catalog/PosterGridScreen';
import { moviesBrowse } from './browseState';

const loadMovies = (keys: readonly string[]) => catalogRepo.getMany('movie', keys);
const externalIdOf = (movie: Movie) => movie.externalId;
const posterOf = (movie: Movie) => movie.poster;
const captionOf = (movie: Movie) => (movie.year === undefined ? undefined : String(movie.year));

export function MoviesScreen() {
  return (
    <PosterGridScreen
      type="movie"
      base="/movies"
      texts={t.movies}
      browse={moviesBrowse}
      loadItems={loadMovies}
      externalIdOf={externalIdOf}
      posterOf={posterOf}
      captionOf={captionOf}
      progress
      gridTestId="movie-grid"
    />
  );
}
