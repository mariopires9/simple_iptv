// Live TV screen (LIV-01): categories + virtualised channel list; the video panel is a
// placeholder until PLY-02/LIV-02 wire the player.
//   < 600 px     → category chips above the list (docs/UX_UI.md §4.3)
//   600–1199 px  → categories | channels
//   ≥ 1200 px    → categories | channels | video panel (docs/UX_UI.md §4.4)
import LiveTvRounded from '@mui/icons-material/LiveTvRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { favoritesRepo, type Channel } from '@/core/db';
import { t } from '@/i18n';
import {
  ChannelListSkeleton,
  DelayedLoading,
  StateView,
  errorDetails,
  visuallyHidden,
} from '@/ui/state';
import {
  DEFAULT_CATEGORY_ID,
  VIRTUAL_CATEGORY_IDS,
  categoryPath,
  type LiveCategory,
} from './categories';
import { CategoryNav } from './CategoryNav';
import { ChannelList } from './ChannelList';
import { loadLiveSource, type LiveSourceState } from './liveSource';
import { PageCache } from './pageCache';
import { createPager } from './pagers';
import { useFillHeight } from './useFillHeight';

/** Minimum height of the Live layout (px); below it the page scrolls. */
const MIN_HEIGHT = 320;

type PagerState =
  | { key: string; base: string; status: 'ready'; cache: PageCache }
  | { key: string; base: string; status: 'error'; error: unknown };

export function LiveScreen() {
  const { categoryId = DEFAULT_CATEGORY_ID } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const isTablet = useMediaQuery(theme.breakpoints.up('sm'), { noSsr: true });
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'), { noSsr: true });

  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState<LiveSourceState>({ status: 'loading' });
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(() => new Set());
  // Latest favourites for the toggle handler (rapid toggles run before a re-render).
  const favoritesRef = useRef(favorites);
  // Bumped when a favourite write settles, so "Favorites" re-reads its (in-memory) list.
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const { ref: fillRef, height } = useFillHeight(MIN_HEIGHT);

  useEffect(() => {
    let cancelled = false;
    loadLiveSource().then(
      (next) => {
        if (cancelled) return;
        setSource(next);
        if (next.status === 'ready') {
          favoritesRef.current = new Set(next.favoriteKeys);
          setFavorites(favoritesRef.current);
        }
      },
      (error: unknown) => {
        if (!cancelled) setSource({ status: 'error', error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const ready = source.status === 'ready' ? source : undefined;
  const category = ready?.categories.find((c) => c.id === categoryId);

  // One pager per (source, category, attempt) — and, for "Favorites", per favourites change; a
  // stale result is ignored by comparing keys. While "Favorites" is re-read, the previous pager of
  // the same category (`base`) stays on screen instead of flashing the skeleton.
  const [pagerAttempt, setPagerAttempt] = useState(0);
  const pagerBase = ready && category ? `${ready.source.id}\n${category.id}\n${pagerAttempt}` : '';
  const pagerKey = category?.kind === 'favorites' ? `${pagerBase}\n${favoritesVersion}` : pagerBase;
  const [pager, setPager] = useState<PagerState | undefined>();
  useEffect(() => {
    if (!ready || !category) return undefined;
    let cancelled = false;
    const base = pagerBase;
    createPager(category, ready.source.id, ready.sourceCategoryKeys, ready.source.lastSyncAt).then(
      (p) => {
        if (!cancelled) setPager({ key: pagerKey, base, status: 'ready', cache: new PageCache(p) });
      },
      (error: unknown) => {
        if (!cancelled) setPager({ key: pagerKey, base, status: 'error', error });
      },
    );
    return () => {
      cancelled = true;
    };
    // `pagerKey` already encodes source, category, attempt (and the favourites version).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagerKey]);
  const currentPager =
    pager?.key === pagerKey || (pager?.status === 'ready' && pager.base === pagerBase)
      ? pager
      : undefined;

  const onPageError = useCallback(
    (error: unknown) => setPager({ key: pagerKey, base: pagerBase, status: 'error', error }),
    [pagerKey, pagerBase],
  );

  const onPlay = useCallback(
    (channel: Channel) => {
      // PLY-02/LIV-02 start playback from this URL; for now it only marks the selection.
      // Replace: picking channels must not stack one history entry per channel.
      navigate(`${categoryPath(categoryId)}?channel=${encodeURIComponent(channel.key)}`, {
        replace: true,
      });
    },
    [navigate, categoryId],
  );

  // Optimistic favourites: the star changes at once and the write runs in the background. Per
  // channel we keep the last state confirmed by IndexedDB and a version per toggle, so a failure
  // rolls back to the confirmed state — and only if no later toggle of that channel superseded it.
  const confirmedFavorite = useRef(new Map<string, boolean>());
  const toggleVersion = useRef(new Map<string, number>());
  const onToggleFavorite = useCallback((channel: Channel) => {
    const { key } = channel;
    const wasFavorite = favoritesRef.current.has(key);
    const favorite = !wasFavorite;
    if (!confirmedFavorite.current.has(key)) confirmedFavorite.current.set(key, wasFavorite);
    const version = (toggleVersion.current.get(key) ?? 0) + 1;
    toggleVersion.current.set(key, version);
    const apply = (value: boolean) => {
      const next = new Set(favoritesRef.current);
      if (value) next.add(key);
      else next.delete(key);
      favoritesRef.current = next;
      setFavorites(next);
    };
    apply(favorite);
    setAnnouncement(
      favorite ? t.live.favoriteAdded(channel.name) : t.live.favoriteRemoved(channel.name),
    );
    const write = favorite ? favoritesRepo.add(key) : favoritesRepo.remove(key);
    write.then(
      () => {
        confirmedFavorite.current.set(key, favorite);
        setFavoritesVersion((n) => n + 1);
      },
      () => {
        if (toggleVersion.current.get(key) !== version) return;
        apply(confirmedFavorite.current.get(key) ?? wasFavorite);
        setAnnouncement(t.live.favoriteFailed(channel.name));
      },
    );
  }, []);

  const retrySource = () => {
    setSource({ status: 'loading' });
    setAttempt((n) => n + 1);
  };

  let content;
  if (source.status === 'loading') {
    content = (
      <DelayedLoading>
        <ChannelListSkeleton />
      </DelayedLoading>
    );
  } else if (source.status === 'no-source') {
    content = (
      <StateView
        variant="empty"
        title={t.live.noSource.title}
        message={t.live.noSource.message}
        actions={
          <>
            <Button variant="contained" component={Link} to="/onboarding">
              {t.live.noSource.add}
            </Button>
            <Button component={Link} to="/settings/sources">
              {t.live.noSource.manage}
            </Button>
          </>
        }
      />
    );
  } else if (source.status === 'error') {
    content = <LoadError error={source.error} onRetry={retrySource} />;
  } else {
    const nav = (
      <CategoryNav
        categories={source.categories}
        selectedId={categoryId}
        variant={isTablet ? 'list' : 'chips'}
      />
    );
    content = (
      <Box
        sx={{
          height: '100%',
          display: 'grid',
          gap: isTablet ? 2 : 1,
          gridTemplateColumns: isDesktop
            ? '240px minmax(320px, 420px) 1fr'
            : isTablet
              ? '240px 1fr'
              : '1fr',
          gridTemplateRows: isTablet ? '1fr' : 'auto 1fr',
          minHeight: 0,
        }}
      >
        {nav}
        <Box sx={{ minHeight: 0, bgcolor: 'tokens.surface1', borderRadius: 3, overflow: 'hidden' }}>
          <ChannelPane
            category={category}
            pager={currentPager}
            favorites={favorites}
            playingKey={searchParams.get('channel') ?? undefined}
            onPlay={onPlay}
            onToggleFavorite={onToggleFavorite}
            onPageError={onPageError}
            onRetry={() => setPagerAttempt((n) => n + 1)}
          />
        </Box>
        {isDesktop && <PlayerPlaceholder />}
      </Box>
    );
  }

  return (
    <Box
      ref={fillRef}
      // Fills the free space of <main> (measured, see useFillHeight); the list scrolls inside.
      style={height !== undefined ? { height } : undefined}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: MIN_HEIGHT }}
    >
      <Typography variant="h3" component="h1" sx={isTablet ? undefined : visuallyHidden}>
        {t.live.title}
      </Typography>
      <Box sx={{ flex: 1, minHeight: 0 }}>{content}</Box>
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
    </Box>
  );
}

interface ChannelPaneProps {
  category: LiveCategory | undefined;
  pager: PagerState | undefined;
  favorites: ReadonlySet<string>;
  playingKey: string | undefined;
  onPlay: (channel: Channel) => void;
  onToggleFavorite: (channel: Channel) => void;
  onPageError: (error: unknown) => void;
  onRetry: () => void;
}

function ChannelPane({
  category,
  pager,
  favorites,
  playingKey,
  onPlay,
  onToggleFavorite,
  onPageError,
  onRetry,
}: ChannelPaneProps) {
  const showAll = (
    <Button variant="contained" component={Link} to={categoryPath(VIRTUAL_CATEGORY_IDS.all)}>
      {t.live.emptyCategory.showAll}
    </Button>
  );
  if (!category) {
    return (
      <StateView
        variant="empty"
        title={t.live.categoryNotFound.title}
        message={t.live.categoryNotFound.message}
        actions={showAll}
      />
    );
  }
  if (!pager) {
    return (
      <DelayedLoading>
        <ChannelListSkeleton />
      </DelayedLoading>
    );
  }
  if (pager.status === 'error') return <LoadError error={pager.error} onRetry={onRetry} />;
  if (pager.cache.total === 0) {
    if (category.kind === 'favorites') {
      return (
        <StateView
          variant="empty"
          title={t.live.emptyFavorites.title}
          message={t.live.emptyFavorites.message}
          actions={showAll}
        />
      );
    }
    if (category.kind === 'recent') {
      return (
        <StateView
          variant="empty"
          title={t.live.emptyRecent.title}
          message={t.live.emptyRecent.message}
          actions={showAll}
        />
      );
    }
    return (
      <StateView
        variant="empty"
        title={t.live.emptyCategory.title}
        actions={category.kind === 'all' ? undefined : showAll}
      />
    );
  }
  return (
    <ChannelList
      // A new list (scroll and selection reset) per category and pager.
      key={pager.key}
      cache={pager.cache}
      label={t.live.channelsIn(category.name)}
      favorites={favorites}
      playingKey={playingKey}
      onPlay={onPlay}
      onToggleFavorite={onToggleFavorite}
      onError={onPageError}
    />
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <StateView
      variant="error"
      title={t.live.loadError.title}
      message={t.live.loadError.message}
      details={errorDetails(error)}
      actions={
        <Button variant="contained" onClick={onRetry}>
          {t.state.actions.retry}
        </Button>
      }
    />
  );
}

/** Video panel area (desktop); the player arrives with PLY-02. */
function PlayerPlaceholder() {
  return (
    <Box
      component="section"
      aria-label={t.live.title}
      sx={{
        aspectRatio: '16 / 9',
        alignSelf: 'start',
        bgcolor: 'tokens.surface2',
        borderRadius: 3,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        color: 'text.secondary',
        p: 2,
        textAlign: 'center',
      }}
    >
      <LiveTvRounded aria-hidden sx={{ fontSize: 48 }} />
      <Typography>{t.live.player.idle}</Typography>
    </Box>
  );
}
