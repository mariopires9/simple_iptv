// Movie details (VOD-02, VOD-03, docs/UX_UI.md §4.7): the shared details header (blurred backdrop,
// poster, title, year, duration, rating, genre, synopsis — `@/ui/catalog/DetailsHero`) with
// Play / "Resume at mm:ss" + "Start from the beginning" and ★ favourite.
//
// - The movie comes from the active list's catalogue (`/movies/:movieId`, the provider's id).
// - Xtream: `get_vod_info` adds/overrides fields (24 h cache, movieInfo.ts). Missing fields are
//   simply not rendered. A failure keeps the catalogue data and still allows playback (AC4).
// - Resume (VOD-03 AC2): offered from 1 min up to 95 % of the duration (`@/ui/vod/resume`); the
//   player saves the position, and the buttons follow it when the player closes.
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import StarBorderRounded from '@mui/icons-material/StarBorderRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  catalogRepo,
  favoritesRepo,
  historyRepo,
  isProtectedItem,
  itemKey,
  parseCategoryKey,
  type HistoryEntry,
  type Movie,
  type Source,
} from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import type { VodInfo } from '@/providers/xtream';
import { openedFromGrid } from '@/ui/catalog/browseState';
import { resolveActiveSource } from '@/ui/catalog/catalogSource';
import { DetailsHero } from '@/ui/catalog/DetailsHero';
import { formatClock, formatDuration } from '@/ui/catalog/format';
import { useFavoriteToggle } from '@/ui/catalog/useFavoriteToggle';
import { useActiveSource } from '@/ui/hooks/useActiveSource';
import {
  DelayedLoading,
  DetailHeaderSkeleton,
  StateView,
  errorDetails,
  visuallyHidden,
} from '@/ui/state';
import { resumePosition, type ProgressSnapshot } from '@/ui/vod/resume';
import { lastBrowseLocation, moviesBrowse } from './browseState';
import { ALL_CATEGORY_ID, categoryPath } from './categories';
import { loadMovieInfo } from './movieInfo';
import { MoviePlayer } from './MoviePlayer';

type DetailsState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; error: unknown }
  | {
      status: 'ready';
      source: Source;
      movie: Movie;
      history: HistoryEntry | undefined;
      favorite: boolean;
    };

type InfoState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ok'; info: VodInfo }
  | { status: 'failed' };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function loadDetails(movieId: string): Promise<DetailsState> {
  const source = await resolveActiveSource();
  if (!source) return { status: 'not-found' };
  let key: string;
  try {
    key = itemKey(source.id, 'movie', movieId);
  } catch {
    return { status: 'not-found' };
  }
  const [movie, history, favorite] = await Promise.all([
    catalogRepo.get('movie', key),
    historyRepo.get(key),
    favoritesRepo.has(key),
  ]);
  if (!movie) return { status: 'not-found' };
  return { status: 'ready', source, movie, history, favorite };
}

/** Fallback of "Back to movies": the movie's category (else the last one) with the last sort. */
export function backTarget(movie: Movie | undefined): { pathname: string; search: string } {
  const last = lastBrowseLocation();
  const parsed = movie?.categoryKey ? parseCategoryKey(movie.categoryKey) : undefined;
  const categoryId = parsed?.externalId ?? last?.categoryId ?? ALL_CATEGORY_ID;
  return { pathname: categoryPath(categoryId), search: last?.search ?? '' };
}

export function MovieDetailsScreen() {
  const { movieId = '' } = useParams();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; details: DetailsState }>();
  const requestKey = `${movieId}\n${attempt}`;

  useEffect(() => {
    let cancelled = false;
    loadDetails(movieId).then(
      (details) => {
        if (!cancelled) setState({ key: requestKey, details });
      },
      (error: unknown) => {
        if (!cancelled) setState({ key: requestKey, details: { status: 'error', error } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [movieId, requestKey]);
  const details: DetailsState = state?.key === requestKey ? state.details : { status: 'loading' };

  // SRC-08 AC4: another list became active → this movie belongs to the previous one.
  const active = useActiveSource();
  const seenActive = useRef<{ id: string | undefined } | undefined>(undefined);
  useEffect(() => {
    if (!active.known) return;
    const previous = seenActive.current;
    seenActive.current = { id: active.id };
    if (previous === undefined || previous.id === active.id) return;
    navigate(categoryPath(ALL_CATEGORY_ID), { replace: true });
  }, [active.known, active.id, navigate]);

  // Back: opened from the grid → history back (category, sort and scroll are restored there);
  // otherwise (deep link, reload) → the movie's category with the last sort used.
  const location = useLocation();
  const fromGrid = openedFromGrid(location.state, moviesBrowse);
  const backTo = backTarget(details.status === 'ready' ? details.movie : undefined);
  const back = (
    <Button
      component={Link}
      to={backTo}
      onClick={(event: MouseEvent) => {
        if (!fromGrid) return;
        event.preventDefault();
        void navigate(-1);
      }}
      startIcon={<ArrowBackRounded aria-hidden />}
      sx={{ alignSelf: 'flex-start', minHeight: 44 }}
    >
      {t.movies.details.back}
    </Button>
  );

  let content;
  switch (details.status) {
    case 'loading':
      content = (
        <DelayedLoading>
          <DetailHeaderSkeleton />
        </DelayedLoading>
      );
      break;
    case 'not-found':
      content = (
        <StateView
          variant="empty"
          headingLevel={1}
          title={t.movies.details.notFound.title}
          message={t.movies.details.notFound.message}
        />
      );
      break;
    case 'error':
      content = (
        <StateView
          variant="error"
          headingLevel={1}
          title={t.movies.details.loadError.title}
          message={t.movies.details.loadError.message}
          details={errorDetails(details.error)}
          actions={
            <Button variant="contained" onClick={() => setAttempt((n) => n + 1)}>
              {t.state.actions.retry}
            </Button>
          }
        />
      );
      break;
    case 'ready':
      content = <MovieDetails key={details.movie.key} {...details} />;
      break;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {back}
      {content}
    </Box>
  );
}

interface MovieDetailsProps {
  source: Source;
  movie: Movie;
  history: HistoryEntry | undefined;
  favorite: boolean;
}

function MovieDetails({
  source,
  movie,
  history: initialHistory,
  favorite: initialFavorite,
}: MovieDetailsProps) {
  const texts = t.movies.details;
  const [info, setInfo] = useState<InfoState>(
    source.kind === 'xtream' ? { status: 'loading' } : { status: 'none' },
  );
  // Settles with the details' container extension (or `undefined`) once `get_vod_info` answers or
  // fails; Play waits on it (bounded) when the catalogue has no extension.
  const [infoExt] = useState(() => deferred<string | undefined>());
  useEffect(() => {
    if (source.kind !== 'xtream') {
      infoExt.resolve(undefined);
      return undefined;
    }
    const controller = new AbortController();
    loadMovieInfo(source, movie, { signal: controller.signal }).then(
      (next) => {
        infoExt.resolve(next.ext);
        if (!controller.signal.aborted) setInfo({ status: 'ok', info: next });
      },
      (error: unknown) => {
        // Unmounted (or a new movie): the request was aborted on purpose.
        if (controller.signal.aborted) return;
        infoExt.resolve(undefined);
        // Never the URL or the credentials: only the error's name.
        log.warn('movies: get_vod_info failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
        setInfo({ status: 'failed' });
      },
    );
    return () => controller.abort();
  }, [source, movie, infoExt]);
  const getInfoExt = useCallback(() => infoExt.promise, [infoExt]);

  const extra = info.status === 'ok' ? info.info : undefined;
  const poster = movie.poster ?? extra?.poster;
  const meta: string[] = [];
  const year = extra?.year ?? movie.year;
  const duration = formatDuration(extra?.durationSec, texts);
  const genre = extra?.genre ?? movie.genre;
  if (year !== undefined) meta.push(String(year));
  if (duration !== undefined) meta.push(duration);
  if (genre !== undefined) meta.push(genre);

  const {
    favorite,
    toggle: toggleFavorite,
    announcement,
  } = useFavoriteToggle(movie.key, movie.name, initialFavorite, texts);

  // --- playback (VOD-03) ------------------------------------------------------------------------
  const [history, setHistory] = useState(initialHistory);
  const resumeAt = resumePosition(history);
  /** The player and where it starts (`undefined` = from the beginning). */
  const [playing, setPlaying] = useState<{ startAt: number | undefined }>();
  const playButton = useRef<HTMLButtonElement>(null);
  const closePlayer = useCallback(() => {
    setPlaying(undefined);
    // Back to the button that opened it.
    queueMicrotask(() => playButton.current?.focus());
  }, [setPlaying]);
  const onSaved = useCallback(
    (snapshot: ProgressSnapshot) =>
      setHistory((previous) => ({
        itemKey: movie.key,
        sourceId: movie.sourceId,
        type: 'movie',
        ...previous,
        ...snapshot,
        lastWatchedAt: Date.now(),
      })),
    [movie.key, movie.sourceId],
  );
  const titleId = useId();
  // UX-07: DRM/DASH movies are marked and Play is disabled — the player is never opened.
  const protectedNoteId = useId();
  const isProtected = isProtectedItem(movie);

  return (
    <Box component="article" aria-labelledby={titleId} sx={{ position: 'relative' }}>
      {playing && !isProtected && (
        <Box sx={{ mb: 2 }}>
          <MoviePlayer
            source={source}
            movie={movie}
            startAt={playing.startAt}
            getInfoExt={getInfoExt}
            onSaved={onSaved}
            onClose={closePlayer}
          />
        </Box>
      )}
      <DetailsHero
        title={movie.name}
        titleId={titleId}
        poster={poster}
        backdrop={extra?.backdrop ?? poster}
        meta={meta}
        rating={extra?.rating ?? movie.rating}
        plot={extra?.plot ?? movie.plot}
        director={extra?.director}
        cast={extra?.cast}
        texts={texts}
        testIdPrefix="movie"
        protectedNoteId={isProtected ? protectedNoteId : undefined}
        actions={
          <>
            <Button
              ref={playButton}
              variant="contained"
              size="large"
              startIcon={<PlayArrowRounded aria-hidden />}
              onClick={() => setPlaying({ startAt: resumeAt })}
              disabled={isProtected}
              aria-describedby={isProtected ? protectedNoteId : undefined}
              sx={{ minHeight: 44 }}
            >
              {resumeAt !== undefined ? texts.resumeAt(formatClock(resumeAt)) : texts.play}
            </Button>
            {resumeAt !== undefined && !isProtected && (
              <Button
                variant="outlined"
                size="large"
                startIcon={<ReplayRounded aria-hidden />}
                onClick={() => setPlaying({ startAt: undefined })}
                sx={{ minHeight: 44 }}
              >
                {texts.startOver}
              </Button>
            )}
            <Button
              variant="outlined"
              size="large"
              aria-pressed={favorite}
              startIcon={favorite ? <StarRounded aria-hidden /> : <StarBorderRounded aria-hidden />}
              onClick={toggleFavorite}
              sx={{ minHeight: 44 }}
            >
              {favorite ? texts.removeFavorite : texts.addFavorite}
            </Button>
          </>
        }
        footer={
          info.status === 'failed' && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {texts.infoFailed}
            </Typography>
          )
        }
      />
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
    </Box>
  );
}
