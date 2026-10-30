// TV guide screen (EPG-04): the guide grid of one Live category of the active list, with the
// programme details dialog. Playing a channel opens it in Live (`?channel=`), which keeps the
// player, zapping and the protected-content checks in one place.
//
// - Parental control (SEC-03): while locked, restricted categories are not offered and their
//   channels are left out of "All", "Favorites" and "Recent" (same pager options as Live).
// - "Hide protected content" (UX-07): the same pager filtering as Live; protected channels that
//   remain are marked and cannot be played.
// - The category is in the URL (`?category=<route id>`), so a reload keeps it.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import { useTheme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { isProtectedItem, type Channel } from '@/core/db';
import { t } from '@/i18n';
import { useFillHeight } from '@/ui/hooks/useFillHeight';
import { useParental } from '@/ui/parental';
import { liveChannelPath } from '@/ui/routes/live';
import {
  ChannelListSkeleton,
  DelayedLoading,
  StateView,
  errorDetails,
  visuallyHidden,
} from '@/ui/state';
import { DEFAULT_CATEGORY_ID, type LiveCategory } from './categories';
import type { ShortEpgProgramme } from './epg';
import { EpgGrid } from './EpgGrid';
import { createGuideEpgService } from './guideEpg';
import { guideWindow } from './guideLayout';
import { loadLiveSource, type LiveSourceState } from './liveSource';
import { PageCache } from './pageCache';
import { createPager } from './pagers';
import { ProgrammeDialog } from './ProgrammeDialog';

const MIN_HEIGHT = 320;
/** How often the "now" line moves. */
export const GUIDE_TICK_MS = 30_000;

type PagerState =
  | { key: string; status: 'ready'; cache: PageCache }
  | { key: string; status: 'error'; error: unknown };

export function GuideScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const theme = useTheme();
  const isTablet = useMediaQuery(theme.breakpoints.up('sm'), { noSsr: true });
  const { ref: fillRef, height } = useFillHeight(MIN_HEIGHT);
  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState<LiveSourceState>({ status: 'loading' });
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadLiveSource().then(
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

  const ready = source.status === 'ready' ? source : undefined;
  const parental = useParental();
  const locked = parental.locked;
  // Restricted categories are not offered while locked (SEC-03).
  const categories = useMemo(
    () => (ready?.categories ?? []).filter((c) => c.kind !== 'source' || !locked.has(c.key)),
    [ready, locked],
  );
  const wanted = searchParams.get('category') ?? DEFAULT_CATEGORY_ID;
  const category: LiveCategory | undefined =
    categories.find((c) => c.id === wanted) ?? categories.find((c) => c.id === DEFAULT_CATEGORY_ID);

  const pagerKey =
    ready && category && parental.known
      ? `${ready.source.id}\n${category.id}\n${attempt}\n${[...locked].join(',')}`
      : '';
  const [pager, setPager] = useState<PagerState>();
  useEffect(() => {
    if (!ready || !category || pagerKey === '') return undefined;
    let cancelled = false;
    const key = pagerKey;
    const allKeys = ready.sourceCategoryKeys.filter((k) => !locked.has(k));
    createPager(category, ready.source.id, allKeys, ready.source.lastSyncAt, {
      hideProtected: ready.hideProtected,
      lockedCategories: locked,
    }).then(
      (p) => {
        if (!cancelled) setPager({ key, status: 'ready', cache: new PageCache(p) });
      },
      (error: unknown) => {
        if (!cancelled) setPager({ key, status: 'error', error });
      },
    );
    return () => {
      cancelled = true;
    };
    // `pagerKey` encodes source, category, attempt and the locked categories.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagerKey]);
  const currentPager = pager?.key === pagerKey ? pager : undefined;
  const onPageError = useCallback(
    (error: unknown) => setPager({ key: pagerKey, status: 'error', error }),
    [pagerKey],
  );

  // One time span and one programme service per loaded source; leaving cancels what is in flight.
  const [span] = useState(() => guideWindow(Date.now()));
  const readySource = ready?.source;
  const epg = useMemo(
    () => (readySource ? createGuideEpgService(readySource, span) : undefined),
    [readySource, span],
  );
  useEffect(() => () => epg?.cancel(), [epg]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), GUIDE_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const [details, setDetails] = useState<{ channel: Channel; programme: ShortEpgProgramme }>();
  const onOpen = useCallback(
    (channel: Channel, programme: ShortEpgProgramme) => setDetails({ channel, programme }),
    [],
  );
  const categoryId = category?.id;
  const onPlay = useCallback(
    (channel: Channel) => {
      if (isProtectedItem(channel)) {
        // UX-07: announced, never started.
        setAnnouncement(t.state.protectedContent.unplayable);
        return;
      }
      navigate(liveChannelPath(categoryId, channel.key));
    },
    [navigate, categoryId],
  );

  const selectCategory = (id: string) =>
    setSearchParams(id === DEFAULT_CATEGORY_ID ? {} : { category: id }, { replace: true });

  let content;
  if (source.status === 'loading' || (ready && !currentPager)) {
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
          <Button variant="contained" component={Link} to="/onboarding">
            {t.live.noSource.add}
          </Button>
        }
      />
    );
  } else if (source.status === 'error' || currentPager?.status === 'error') {
    const error =
      source.status === 'error' ? source.error : (currentPager as { error: unknown }).error;
    content = (
      <StateView
        variant="error"
        title={t.live.loadError.title}
        message={t.live.loadError.message}
        details={errorDetails(error)}
        actions={
          <Button
            variant="contained"
            onClick={() => {
              if (source.status === 'error') setSource({ status: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            {t.state.actions.retry}
          </Button>
        }
      />
    );
  } else if (!epg) {
    content = (
      <StateView
        variant="empty"
        title={t.live.guide.noEpg.title}
        message={t.live.guide.noEpg.message}
      />
    );
  } else if (currentPager?.status === 'ready' && currentPager.cache.total === 0) {
    content = <StateView variant="empty" title={t.live.guide.empty} />;
  } else if (currentPager?.status === 'ready' && category) {
    content = (
      <Box
        sx={{
          height: '100%',
          bgcolor: 'tokens.surface1',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <EpgGrid
          key={currentPager.key}
          cache={currentPager.cache}
          epg={epg}
          span={span}
          now={now}
          label={t.live.guide.gridLabel(category.name)}
          channelWidth={isTablet ? 200 : 120}
          onPlay={onPlay}
          onOpen={onOpen}
          onError={onPageError}
        />
      </Box>
    );
  }

  return (
    <Box
      ref={fillRef}
      style={height !== undefined ? { height } : undefined}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: MIN_HEIGHT }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
        <Typography variant="h3" component="h1" sx={{ flex: 1, minWidth: 0 }}>
          {t.live.guide.title}
        </Typography>
        {categories.length > 0 && category && (
          <TextField
            select
            size="small"
            label={t.live.guide.category}
            value={category.id}
            onChange={(event) => selectCategory(event.target.value)}
            sx={{ minWidth: 180 }}
          >
            {categories.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Button component={Link} to="/live">
          {t.live.guide.back}
        </Button>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>{content}</Box>
      <ProgrammeDialog
        selection={details}
        onClose={() => setDetails(undefined)}
        onWatch={(channel) => {
          setDetails(undefined);
          onPlay(channel);
        }}
      />
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
    </Box>
  );
}
