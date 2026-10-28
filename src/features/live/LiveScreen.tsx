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
import { useCallback, useEffect, useState } from 'react';
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
import { navSize, pageMargin } from '@/ui/theme/tokens';
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

/** Height of the MUI bottom navigation on mobile (px). */
const BOTTOM_NAV_HEIGHT = 56;

type PagerState =
  | { key: string; status: 'ready'; cache: PageCache }
  | { key: string; status: 'error'; error: unknown };

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
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadLiveSource().then(
      (next) => {
        if (cancelled) return;
        setSource(next);
        if (next.status === 'ready') setFavorites(new Set(next.favoriteKeys));
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

  // One pager per (source, category, attempt); a stale result is ignored by comparing keys.
  const [pagerAttempt, setPagerAttempt] = useState(0);
  const pagerKey = ready && category ? `${ready.source.id}\n${category.id}\n${pagerAttempt}` : '';
  const [pager, setPager] = useState<PagerState | undefined>();
  useEffect(() => {
    if (!ready || !category) return undefined;
    let cancelled = false;
    createPager(category, ready.source.id, ready.sourceCategoryKeys).then(
      (p) => {
        if (!cancelled) setPager({ key: pagerKey, status: 'ready', cache: new PageCache(p) });
      },
      (error: unknown) => {
        if (!cancelled) setPager({ key: pagerKey, status: 'error', error });
      },
    );
    return () => {
      cancelled = true;
    };
    // `pagerKey` already encodes source, category and attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagerKey]);
  const currentPager = pager?.key === pagerKey ? pager : undefined;

  const onPageError = useCallback(
    (error: unknown) => setPager({ key: pagerKey, status: 'error', error }),
    [pagerKey],
  );

  const onPlay = useCallback(
    (channel: Channel) => {
      // PLY-02/LIV-02 start playback from this URL; for now it only marks the selection.
      navigate(`${categoryPath(categoryId)}?channel=${encodeURIComponent(channel.key)}`);
    },
    [navigate, categoryId],
  );

  const onToggleFavorite = useCallback(
    (channel: Channel) => {
      const wasFavorite = favorites.has(channel.key);
      const apply = (favorite: boolean) =>
        setFavorites((current) => {
          const next = new Set(current);
          if (favorite) next.add(channel.key);
          else next.delete(channel.key);
          return next;
        });
      // Optimistic: the star changes at once; a failed write is rolled back and announced.
      apply(!wasFavorite);
      setAnnouncement(
        wasFavorite ? t.live.favoriteRemoved(channel.name) : t.live.favoriteAdded(channel.name),
      );
      const write = wasFavorite
        ? favoritesRepo.remove(channel.key)
        : favoritesRepo.add(channel.key);
      write.catch(() => {
        apply(wasFavorite);
        setAnnouncement(t.live.favoriteFailed(channel.name));
      });
    },
    [favorites],
  );

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
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minHeight: 320,
        height: {
          xs: `calc(100dvh - ${navSize.topBar + BOTTOM_NAV_HEIGHT + 2 * pageMargin.mobile}px)`,
          sm: `calc(100dvh - ${navSize.topBar + 2 * pageMargin.tablet}px)`,
          lg: `calc(100dvh - ${navSize.topBar + 2 * pageMargin.desktop}px)`,
        },
      }}
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
