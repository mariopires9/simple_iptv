// Movies screen (VOD-01): categories, sort and the virtualised poster grid.
//   < 600 px  → category chips above a 3-column grid (docs/UX_UI.md §8)
//   ≥ 600 px  → side category list | grid (4–6 columns on tablet, 6–8 on desktop)
// The category is in the path (`/movies/category/:categoryId`) and the sort in the query
// (`?sort=name|rating`; "Recently added" is the default and leaves no parameter), so both survive
// a reload and work as deep links.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useTheme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { activeLocale, t } from '@/i18n';
import { CategoryNav } from '@/ui/catalog/CategoryNav';
import { useActiveSource } from '@/ui/hooks/useActiveSource';
import { useFillHeight } from '@/ui/hooks/useFillHeight';
import { DelayedLoading, PosterGridSkeleton, StateView, errorDetails } from '@/ui/state';
import { ALL_CATEGORY_ID, categoryPath, type MovieCategory } from './categories';
import { rememberBrowse } from './browseState';
import { MovieGrid, type GridBand } from './MovieGrid';
import { loadMoviesSource, type MoviesSourceState } from './moviesSource';
import { MoviePageCache } from './pageCache';
import {
  DEFAULT_SORT,
  isSortMode,
  loadProjection,
  sortedKeys,
  type SortMode,
  type SortProjection,
} from './sortIndex';

/** Minimum height of the Movies layout (px); below it the page scrolls. */
const MIN_HEIGHT = 360;

type ProjectionState =
  | { key: string; status: 'ready'; projection: SortProjection }
  | { key: string; status: 'error'; error: unknown };

export function MoviesScreen() {
  const { categoryId = ALL_CATEGORY_ID } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const isTablet = useMediaQuery(theme.breakpoints.up('sm'), { noSsr: true });
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'), { noSsr: true });
  const { ref: fillRef, height } = useFillHeight(MIN_HEIGHT);

  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState<MoviesSourceState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    loadMoviesSource().then(
      (next) => {
        if (!cancelled) setSource(next);
      },
      (error: unknown) => {
        if (!cancelled) setSource({ status: 'error', error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // SRC-08 AC4: another list became active → leave a category of the previous list and reload.
  // The first known value is not a change.
  const active = useActiveSource();
  const seenActive = useRef<{ id: string | undefined } | undefined>(undefined);
  useEffect(() => {
    if (!active.known) return;
    const previous = seenActive.current;
    seenActive.current = { id: active.id };
    if (previous === undefined || previous.id === active.id) return;
    if (categoryId !== ALL_CATEGORY_ID) {
      navigate(
        { pathname: categoryPath(ALL_CATEGORY_ID), search: searchParams.toString() },
        {
          replace: true,
        },
      );
    }
    setSource({ status: 'loading' });
    setAttempt((n) => n + 1);
    // Only a change of the active list triggers this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.known, active.id]);

  const ready = source.status === 'ready' ? source : undefined;
  const category = ready?.categories.find((c) => c.id === categoryId);

  // The sort projection of the category (see sortIndex.ts), one per (source, category, attempt).
  const [projectionAttempt, setProjectionAttempt] = useState(0);
  const projectionKey =
    ready && category ? `${ready.source.id}\n${attempt}\n${category.id}\n${projectionAttempt}` : '';
  const [projection, setProjection] = useState<ProjectionState>();
  useEffect(() => {
    if (!ready || !category) return undefined;
    let cancelled = false;
    const key = projectionKey;
    const keys = category.kind === 'all' ? ready.sourceCategoryKeys : [category.key];
    loadProjection(ready.source.id, ready.source.lastSyncAt, keys).then(
      (p) => {
        if (!cancelled) setProjection({ key, status: 'ready', projection: p });
      },
      (error: unknown) => {
        if (!cancelled) setProjection({ key, status: 'error', error });
      },
    );
    return () => {
      cancelled = true;
    };
    // `projectionKey` encodes source, category and attempts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectionKey]);
  const current = projection?.key === projectionKey ? projection : undefined;
  const loaded = current?.status === 'ready' ? current.projection : undefined;

  const requested = searchParams.get('sort');
  const sort: SortMode = isSortMode(requested) ? requested : DEFAULT_SORT;
  // "Rating" only when the category has ratings (VOD-01 AC2).
  const effectiveSort: SortMode =
    sort === 'rating' && loaded && !loaded.hasRatings ? DEFAULT_SORT : sort;

  const cache = useMemo(
    () =>
      loaded
        ? new MoviePageCache(sortedKeys(loaded.rows, effectiveSort, activeLocale()))
        : undefined,
    [loaded, effectiveSort],
  );
  const [pageError, setPageError] = useState<{ cache: MoviePageCache; error: unknown }>();
  const onPageError = useCallback(
    (error: unknown) => {
      if (cache) setPageError({ cache, error });
    },
    [cache],
  );
  const failedPage = pageError !== undefined && pageError.cache === cache ? pageError : undefined;
  const gridError = current?.status === 'error' ? current.error : failedPage?.error;
  // A failed page is not cached: remounting the grid (error cleared) reads it again.
  const retryGrid = () => {
    if (failedPage) setPageError(undefined);
    else setProjectionAttempt((n) => n + 1);
  };

  const onSort = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === DEFAULT_SORT) next.delete('sort');
    else next.set('sort', value);
    setSearchParams(next, { replace: true });
  };
  const search = searchParams.toString() === '' ? '' : `?${searchParams.toString()}`;
  // "Back to movies" from a details page opened some other way returns here (browseState.ts).
  useEffect(() => {
    rememberBrowse({ categoryId, search });
  }, [categoryId, search]);
  const band: GridBand = isDesktop ? 'desktop' : isTablet ? 'tablet' : 'mobile';

  let content;
  if (source.status === 'loading') {
    content = (
      <DelayedLoading>
        <PosterGridSkeleton />
      </DelayedLoading>
    );
  } else if (source.status === 'no-source') {
    content = (
      <StateView
        variant="empty"
        title={t.movies.noSource.title}
        message={t.movies.noSource.message}
        actions={
          <>
            <Button variant="contained" component={Link} to="/onboarding">
              {t.movies.noSource.add}
            </Button>
            <Button component={Link} to="/settings/sources">
              {t.movies.noSource.manage}
            </Button>
          </>
        }
      />
    );
  } else if (source.status === 'error') {
    content = (
      <LoadError
        error={source.error}
        onRetry={() => {
          setSource({ status: 'loading' });
          setAttempt((n) => n + 1);
        }}
      />
    );
  } else {
    const nav = (
      <CategoryNav
        categories={source.categories}
        selectedId={categoryId}
        variant={isTablet ? 'list' : 'chips'}
        label={t.movies.categories}
        pathFor={categoryPath}
        search={search}
      />
    );
    const pane = (
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <GridPane
          category={category}
          cache={cache}
          error={gridError}
          band={band}
          progress={source.progress}
          onPageError={onPageError}
          onRetry={retryGrid}
          gridKey={`${projectionKey}\n${effectiveSort}`}
          search={search}
          restoreKey={`${source.source.id}\n${categoryId}\n${effectiveSort}`}
        />
      </Box>
    );
    const column = { display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 } as const;
    content = isTablet ? (
      <Box
        sx={{
          height: '100%',
          display: 'grid',
          gap: 2,
          gridTemplateColumns: '240px minmax(0, 1fr)',
          gridTemplateRows: '100%',
          minHeight: 0,
        }}
      >
        <Box sx={{ height: '100%', minHeight: 0 }}>{nav}</Box>
        <Box sx={{ ...column, height: '100%' }}>{pane}</Box>
      </Box>
    ) : (
      <Box sx={{ ...column, height: '100%' }}>
        {nav}
        {pane}
      </Box>
    );
  }

  return (
    <Box
      ref={fillRef}
      style={height !== undefined ? { height } : undefined}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: MIN_HEIGHT }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Typography variant="h3" component="h1">
          {t.movies.title}
        </Typography>
        {ready && (
          <TextField
            select
            size="small"
            label={t.movies.sort.label}
            value={effectiveSort}
            onChange={(event) => onSort(event.target.value)}
            sx={{ minWidth: 200 }}
            slotProps={{ select: { native: true } }}
          >
            <option value="added">{t.movies.sort.added}</option>
            <option value="name">{t.movies.sort.name}</option>
            {(loaded ? loaded.hasRatings : sort === 'rating') && (
              <option value="rating">{t.movies.sort.rating}</option>
            )}
          </TextField>
        )}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>{content}</Box>
    </Box>
  );
}

interface GridPaneProps {
  category: MovieCategory | undefined;
  /** Changes per category, sort and reload: a new grid (scroll and focus reset). */
  gridKey: string;
  cache: MoviePageCache | undefined;
  error: unknown;
  band: GridBand;
  progress: ReadonlyMap<string, number>;
  onPageError: (error: unknown) => void;
  onRetry: () => void;
  /** Current query (the sort), kept on "Show all movies". */
  search: string;
  /** Scroll position memory of the grid: per list, category and sort. */
  restoreKey: string;
}

function GridPane({
  category,
  gridKey,
  cache,
  error,
  band,
  progress,
  onPageError,
  onRetry,
  search,
  restoreKey,
}: GridPaneProps) {
  const showAll = (
    <Button
      variant="contained"
      component={Link}
      to={{ pathname: categoryPath(ALL_CATEGORY_ID), search }}
    >
      {t.movies.emptyCategory.showAll}
    </Button>
  );
  if (!category) {
    return (
      <StateView
        variant="empty"
        title={t.movies.categoryNotFound.title}
        message={t.movies.categoryNotFound.message}
        actions={showAll}
      />
    );
  }
  if (error !== undefined) return <LoadError error={error} onRetry={onRetry} />;
  if (!cache) {
    return (
      <DelayedLoading>
        <PosterGridSkeleton />
      </DelayedLoading>
    );
  }
  if (cache.total === 0) {
    return (
      <StateView
        variant="empty"
        title={t.movies.emptyCategory.title}
        actions={category.kind === 'all' ? undefined : showAll}
      />
    );
  }
  return (
    <MovieGrid
      key={gridKey}
      cache={cache}
      label={t.movies.gridLabel(category.name)}
      band={band}
      progress={progress}
      onError={onPageError}
      restoreKey={restoreKey}
    />
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <StateView
      variant="error"
      title={t.movies.loadError.title}
      message={t.movies.loadError.message}
      details={errorDetails(error)}
      actions={
        <Button variant="contained" onClick={onRetry}>
          {t.state.actions.retry}
        </Button>
      }
    />
  );
}
