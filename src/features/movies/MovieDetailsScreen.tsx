// Movie details (VOD-02, docs/UX_UI.md §4.7): blurred backdrop, poster, title, year, duration,
// rating, genre, Play / "Resume at mm:ss", ★ favourite and the synopsis (3 lines + "More").
//
// - The movie comes from the active list's catalogue (`/movies/:movieId`, the provider's id).
// - Xtream: `get_vod_info` adds/overrides fields (24 h cache, movieInfo.ts). Missing fields are
//   simply not rendered — no empty labels or separators. A failure keeps the catalogue data and
//   still allows playback (AC4).
// - Every server text is rendered as React text (never HTML), so markup stays inert (AC2).
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import StarBorderRounded from '@mui/icons-material/StarBorderRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  catalogRepo,
  favoritesRepo,
  historyRepo,
  itemKey,
  type HistoryEntry,
  type Movie,
  type Source,
} from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import type { VodInfo } from '@/providers/xtream';
import {
  DelayedLoading,
  DetailHeaderSkeleton,
  StateView,
  errorDetails,
  visuallyHidden,
} from '@/ui/state';
import { ALL_CATEGORY_ID, categoryPath } from './categories';
import { formatClock, formatDuration, formatRating } from './format';
import { isLoadableImage } from './images';
import { loadMovieInfo } from './movieInfo';
import { MoviePlayer } from './MoviePlayer';
import { resolveActiveSource } from './moviesSource';
import { Poster } from './Poster';
import { useActiveSource } from './useActiveSource';

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

/** Plots longer than this always get "More" (layout measurement is not available everywhere). */
const LONG_PLOT = 240;

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

/** Saved position to resume from, if any (VOD-03 writes it; here it is only read). */
export function resumePosition(entry: HistoryEntry | undefined): number | undefined {
  if (!entry || entry.completed) return undefined;
  const position = entry.positionSec;
  return position !== undefined && Number.isFinite(position) && position >= 1
    ? position
    : undefined;
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

  const back = (
    <Button
      component={Link}
      to={categoryPath(ALL_CATEGORY_ID)}
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

function MovieDetails({ source, movie, history, favorite: initialFavorite }: MovieDetailsProps) {
  const texts = t.movies.details;
  const [info, setInfo] = useState<InfoState>(
    source.kind === 'xtream' ? { status: 'loading' } : { status: 'none' },
  );
  useEffect(() => {
    if (source.kind !== 'xtream') return undefined;
    let cancelled = false;
    loadMovieInfo(source, movie).then(
      (next) => {
        if (!cancelled) setInfo({ status: 'ok', info: next });
      },
      (error: unknown) => {
        if (cancelled) return;
        // Never the URL or the credentials: only the error's name.
        log.warn('movies: get_vod_info failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
        setInfo({ status: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, movie]);

  const extra = info.status === 'ok' ? info.info : undefined;
  const year = extra?.year ?? movie.year;
  const rating = extra?.rating ?? movie.rating;
  const genre = extra?.genre ?? movie.genre;
  const plot = extra?.plot ?? movie.plot;
  const duration = formatDuration(extra?.durationSec);
  const poster = movie.poster ?? extra?.poster;
  const backdrop = extra?.backdrop ?? poster;

  // --- favourite (optimistic) ----------------------------------------------------------------
  const [favorite, setFavorite] = useState(initialFavorite);
  const [announcement, setAnnouncement] = useState('');
  const toggleVersion = useRef(0);
  const toggleFavorite = useCallback(() => {
    const next = !favorite;
    const version = ++toggleVersion.current;
    setFavorite(next);
    setAnnouncement(next ? texts.favoriteAdded(movie.name) : texts.favoriteRemoved(movie.name));
    (next ? favoritesRepo.add(movie.key) : favoritesRepo.remove(movie.key)).catch(() => {
      if (toggleVersion.current !== version) return;
      setFavorite(!next);
      setAnnouncement(texts.favoriteFailed(movie.name));
    });
  }, [favorite, movie, texts]);

  // --- playback ------------------------------------------------------------------------------
  const resumeAt = resumePosition(history);
  const [playing, setPlaying] = useState(false);
  const playButton = useRef<HTMLButtonElement>(null);
  const closePlayer = useCallback(() => {
    setPlaying(false);
    // Back to the button that opened it.
    queueMicrotask(() => playButton.current?.focus());
  }, []);

  // --- synopsis --------------------------------------------------------------------------------
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const plotRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (el && !expanded) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [plot, expanded]);
  const plotId = `movie-plot-${movie.key}`;
  const canExpand = plot !== undefined && (overflowing || plot.length > LONG_PLOT);

  const meta: string[] = [];
  if (year !== undefined) meta.push(String(year));
  if (duration !== undefined) meta.push(duration);
  if (genre !== undefined) meta.push(genre);

  return (
    <Box component="article" aria-labelledby="movie-title" sx={{ position: 'relative' }}>
      {playing && (
        <Box sx={{ mb: 2 }}>
          <MoviePlayer
            source={source}
            movie={movie}
            startAt={resumeAt}
            infoExt={extra?.ext}
            onClose={closePlayer}
          />
        </Box>
      )}
      <Box
        sx={{
          position: 'relative',
          borderRadius: 4,
          overflow: 'hidden',
          bgcolor: 'tokens.surface1',
          p: { xs: 2, sm: 3 },
        }}
      >
        {isLoadableImage(backdrop) && (
          // Decorative blurred backdrop at the top (≤ 40 % of the viewport height).
          <Box
            aria-hidden="true"
            sx={{
              position: 'absolute',
              inset: 0,
              bottom: 'auto',
              height: '40vh',
              maxHeight: '100%',
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            <Box
              component="img"
              src={backdrop}
              alt=""
              referrerPolicy="no-referrer"
              decoding="async"
              data-testid="movie-backdrop"
              sx={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'blur(24px)',
                opacity: 0.35,
                transform: 'scale(1.1)',
              }}
            />
          </Box>
        )}
        <Box
          sx={{
            position: 'relative',
            display: 'grid',
            gap: 3,
            gridTemplateColumns: { xs: '1fr', sm: '200px minmax(0, 1fr)' },
            alignItems: 'start',
          }}
        >
          <Box sx={{ width: { xs: 160, sm: 200 } }}>
            <Poster title={movie.name} url={poster} width={200} eager />
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
            <Typography
              id="movie-title"
              variant="h3"
              component="h1"
              sx={{ wordBreak: 'break-word' }}
            >
              {movie.name}
            </Typography>
            {(meta.length > 0 || rating !== undefined) && (
              <Box
                data-testid="movie-meta"
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  columnGap: 1,
                  rowGap: 0.5,
                  color: 'text.secondary',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {meta.map((part, i) => (
                  <Box component="span" key={i}>
                    {i > 0 && (
                      <Box component="span" aria-hidden="true" sx={{ mr: 1 }}>
                        ·
                      </Box>
                    )}
                    {part}
                  </Box>
                ))}
                {rating !== undefined && (
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
                    {meta.length > 0 && (
                      <Box component="span" aria-hidden="true" sx={{ mr: 1 }}>
                        ·
                      </Box>
                    )}
                    <StarRounded aria-hidden fontSize="small" sx={{ mr: 0.5 }} />
                    <Box component="span" aria-hidden="true">
                      {formatRating(rating)}
                    </Box>
                    <Box component="span" sx={visuallyHidden}>
                      {texts.rating(formatRating(rating))}
                    </Box>
                  </Box>
                )}
              </Box>
            )}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1 }}>
              <Button
                ref={playButton}
                variant="contained"
                size="large"
                startIcon={<PlayArrowRounded aria-hidden />}
                onClick={() => setPlaying(true)}
                sx={{ minHeight: 44 }}
              >
                {resumeAt !== undefined ? texts.resumeAt(formatClock(resumeAt)) : texts.play}
              </Button>
              <Button
                variant="outlined"
                size="large"
                aria-pressed={favorite}
                startIcon={
                  favorite ? <StarRounded aria-hidden /> : <StarBorderRounded aria-hidden />
                }
                onClick={toggleFavorite}
                sx={{ minHeight: 44 }}
              >
                {favorite ? texts.removeFavorite : texts.addFavorite}
              </Button>
            </Box>
            {plot !== undefined && (
              <Box>
                <Typography component="h2" variant="h6" sx={visuallyHidden}>
                  {texts.synopsis}
                </Typography>
                <Typography
                  ref={plotRef}
                  id={plotId}
                  data-testid="movie-plot"
                  sx={{
                    whiteSpace: 'pre-line',
                    wordBreak: 'break-word',
                    ...(!expanded && {
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }),
                  }}
                >
                  {plot}
                </Typography>
                {canExpand && (
                  <Button
                    size="small"
                    aria-expanded={expanded}
                    aria-controls={plotId}
                    onClick={() => setExpanded((e) => !e)}
                    sx={{ mt: 0.5, minHeight: 44 }}
                  >
                    {expanded ? texts.less : texts.more}
                  </Button>
                )}
              </Box>
            )}
            {(extra?.director !== undefined || extra?.cast !== undefined) && (
              <Box component="dl" sx={{ m: 0, display: 'grid', gap: 0.5 }}>
                {extra.director !== undefined && (
                  <Box>
                    <Box component="dt" sx={{ display: 'inline', color: 'text.secondary', mr: 1 }}>
                      {texts.director}
                    </Box>
                    <Box component="dd" sx={{ display: 'inline', m: 0 }}>
                      {extra.director}
                    </Box>
                  </Box>
                )}
                {extra.cast !== undefined && (
                  <Box>
                    <Box component="dt" sx={{ display: 'inline', color: 'text.secondary', mr: 1 }}>
                      {texts.cast}
                    </Box>
                    <Box component="dd" sx={{ display: 'inline', m: 0 }}>
                      {extra.cast}
                    </Box>
                  </Box>
                )}
              </Box>
            )}
            {info.status === 'failed' && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {texts.infoFailed}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
    </Box>
  );
}
