// Live TV screen (LIV-01..04, EPG-01): categories, virtualised channel list with a quick filter,
// the live player with now/next, and the navigation state restored on the next visit.
//   < 600 px     → 16:9 player on top (while playing), category chips, list (docs/UX_UI.md §4.3)
//   600–1199 px  → categories | channels; while playing: chips + list | player (§8)
//   ≥ 1200 px    → categories | channels | player panel (docs/UX_UI.md §4.4)
// The playing channel is in the URL (`?channel=<key>`, replaced — not pushed — on every change),
// so a reload restores it; closing the player removes it.
//
// LIV-03: per source, the category, the selected row and the scroll offset are saved (debounced)
// and restored when the list of that category is shown again; entering bare `/live` (the Live tab,
// or the app opened on it) goes back to the saved category — and, with "Play last channel on
// open", to the last played channel. Explicit deep links (`/live/category/…`) are never redirected.
import LiveTvRounded from '@mui/icons-material/LiveTvRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  catalogRepo,
  favoritesRepo,
  isProtectedItem,
  normalizeName,
  type Channel,
} from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { CategoryNav } from '@/ui/catalog/CategoryNav';
import { useActiveSource } from '@/ui/hooks/useActiveSource';
import { useFillHeight } from '@/ui/hooks/useFillHeight';
import {
  LIVE_VIRTUAL_CATEGORY_IDS,
  liveCategoryPath,
  liveChannelPath,
  liveChannelSearch,
} from '@/ui/routes/live';
import {
  ChannelListSkeleton,
  DelayedLoading,
  StateView,
  errorDetails,
  visuallyHidden,
} from '@/ui/state';
import { DEFAULT_CATEGORY_ID, type LiveCategory } from './categories';
import { keysPager } from './channelFilter';
import { ChannelFilterField } from './ChannelFilterField';
import { ChannelList, type ChannelListView } from './ChannelList';
import { ChannelsOverlay } from './ChannelsOverlay';
import { createEpgService, type EpgService } from './epg';
import {
  LivePlayer,
  type LivePlayerHandle,
  type LiveSelection,
  type SelectionVia,
} from './LivePlayer';
import { loadLiveSource, type LiveSourceState } from './liveSource';
import {
  createViewSaver,
  loadLiveStartup,
  saveLastChannel,
  type LiveStartup,
  type SavedLiveView,
} from './liveState';
import { NowNext } from './NowNext';
import { PageCache } from './pageCache';
import { createPager } from './pagers';
import { neighbour } from './zapping';

/** Minimum height of the Live layout (px); below it the page scrolls. */
const MIN_HEIGHT = 320;

type PagerState =
  | { key: string; base: string; status: 'ready'; cache: PageCache }
  | { key: string; base: string; status: 'error'; error: unknown };

/** Results of the quick filter (LIV-04) for one pager and query. */
interface FilterResult {
  /** Key of the category pager it filters. */
  forKey: string;
  query: string;
  key: string;
  cache: PageCache;
}

/** Saved state read for one source (and one entry on bare `/live`), LIV-03. */
interface Startup {
  sourceId: string;
  bareKey: string | undefined;
  data: LiveStartup;
  /** The category whose first list is restored. */
  openedOn: string;
}

/** Where a category's list was (LIV-03): restored once, then kept up to date by the list. */
interface ListPosition {
  index: number;
  scrollTop?: number;
}

/** History-state field that marks our own redirect as part of the same bare-`/live` entry. */
const ENTRY_STATE = 'liveEntry';

function entryKeyOf(location: { key: string; state: unknown }): string {
  const state = location.state as Record<string, unknown> | null | undefined;
  const carried = state?.[ENTRY_STATE];
  return typeof carried === 'string' ? carried : location.key;
}

interface Selection extends LiveSelection {
  /** Row of the channel in the pager `pagerKey`, when known (zapping starts from it). */
  index: number | undefined;
  pagerKey: string;
}

export function LiveScreen() {
  const { categoryId: routeCategoryId } = useParams();
  const categoryId = routeCategoryId ?? DEFAULT_CATEGORY_ID;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
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
    createPager(category, ready.source.id, ready.sourceCategoryKeys, ready.source.lastSyncAt, {
      hideProtected: ready.hideProtected,
    }).then(
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
  const readyPager = currentPager?.status === 'ready' ? currentPager : undefined;
  const sourceId = ready?.source.id;
  const channelKey = searchParams.get('channel') ?? undefined;

  // --- saved navigation state (LIV-03) -------------------------------------------------------
  // Debounced persistence of the list view; flushed when leaving or hiding the page.
  const [saver] = useState(createViewSaver);
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') saver.flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', saver.flush);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', saver.flush);
      saver.flush();
    };
  }, [saver]);

  // The category shown when the saved state arrives (on bare `/live`: the one it redirects to):
  // only the first list of that category is restored.
  const routeCategoryRef = useRef(routeCategoryId);
  useEffect(() => {
    routeCategoryRef.current = routeCategoryId;
  });
  // Each entry on bare `/live` (e.g. the Live tab while this screen stays mounted) reads the
  // state again: what was saved since the screen opened is the place to go back to. Our own
  // redirect carries the entry's key in the history state, so it is not a new entry (no second
  // read, no skeleton flash).
  const bareKey = routeCategoryId === undefined ? entryKeyOf(location) : undefined;
  const [startup, setStartup] = useState<Startup>();
  const startupRef = useRef(startup);
  useEffect(() => {
    startupRef.current = startup;
  });
  useEffect(() => {
    if (sourceId === undefined) return undefined;
    if (bareKey === undefined && startupRef.current?.sourceId === sourceId) return undefined;
    // A pending debounced save must be written before it is read back.
    saver.flush();
    let cancelled = false;
    void loadLiveStartup(sourceId).then((data) => {
      if (cancelled) return;
      const openedOn = routeCategoryRef.current ?? data.view?.categoryId ?? DEFAULT_CATEGORY_ID;
      setStartup({ sourceId, bareKey, data, openedOn });
    });
    return () => {
      cancelled = true;
    };
  }, [sourceId, bareKey, saver]);
  const current =
    startup &&
    startup.sourceId === sourceId &&
    (bareKey === undefined || startup.bareKey === bareKey)
      ? startup
      : undefined;
  const saved = current?.data;

  // Bare `/live`: back to the saved category (and the last channel, if enabled). Computed, then
  // applied by the effect below; the screen shows its skeleton meanwhile.
  let entry: 'pending' | string | undefined;
  if (routeCategoryId === undefined && ready) {
    if (!saved) entry = 'pending';
    else {
      const { view } = saved;
      // "All" is what bare `/live` shows anyway: no redirect needed for it.
      const target =
        view &&
        view.categoryId !== DEFAULT_CATEGORY_ID &&
        ready.categories.some((c) => c.id === view.categoryId)
          ? view.categoryId
          : undefined;
      const play =
        channelKey === undefined && saved.playLastChannelOnOpen ? saved.lastChannelKey : undefined;
      if (target !== undefined || play !== undefined) {
        const keep = play ?? channelKey;
        entry = `${target !== undefined ? liveCategoryPath(target) : '/live'}${
          keep !== undefined ? liveChannelSearch(keep) : ''
        }`;
      }
    }
  }
  useEffect(() => {
    if (entry !== undefined && entry !== 'pending') {
      navigate(entry, { replace: true, state: { [ENTRY_STATE]: bareKey } });
    }
  }, [entry, navigate, bareKey]);

  // The first list of the saved category starts at the saved row and offset. The saved row is
  // checked by key: after a sync moved it, the channel is located again (and centred).
  // The restore is one-shot: it seeds `viewMemory`, which every later report of the list keeps
  // up to date, so a remount (filter cleared, layout change, back to the category) starts where
  // the list really was — never at the saved position again.
  const viewMemory = useRef(new Map<string, ListPosition>());
  const [restoredFor, setRestoredFor] = useState<Startup>();
  const savedView = saved?.view;
  const wantsRestore =
    current !== undefined &&
    restoredFor !== current &&
    savedView !== undefined &&
    savedView.categoryId === categoryId &&
    current.openedOn === categoryId;
  useEffect(() => {
    if (!wantsRestore || !current || !savedView || !readyPager || readyPager.key !== pagerKey) {
      return undefined;
    }
    let cancelled = false;
    const { cache, key } = readyPager;
    const view = savedView;
    const settle = (index: number, scrollTop: number | undefined) => {
      if (cancelled) return;
      viewMemory.current.set(key, scrollTop === undefined ? { index } : { index, scrollTop });
      setRestoredFor(current);
    };
    const fallback = Math.max(0, Math.min(view.selectedIndex, cache.total - 1));
    const locate = async (): Promise<number> => {
      if (view.selectedKey === undefined) return -1;
      const channel = await catalogRepo.get('live', view.selectedKey);
      return channel && channel.sourceId === sourceId ? cache.pager.locate(channel) : -1;
    };
    locate().then(
      (found) => {
        if (found >= 0 && found !== view.selectedIndex) settle(found, undefined);
        else settle(fallback, view.scrollTop);
      },
      (error: unknown) => {
        log.warn('live: restoring the list position failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
        settle(0, undefined);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [wantsRestore, current, savedView, readyPager, pagerKey, sourceId]);

  // --- quick filter (LIV-04) -----------------------------------------------------------------
  const [filterInput, setFilterInput] = useState<{ base: string; text: string }>({
    base: '',
    text: '',
  });
  // A new category (or source) starts unfiltered.
  const filterText = filterInput.base === pagerBase ? filterInput.text : '';
  const query = normalizeName(filterText);
  const setFilterText = useCallback(
    (text: string) => setFilterInput({ base: pagerBase, text }),
    [pagerBase],
  );
  const [filterResult, setFilterResult] = useState<FilterResult>();
  // Building the index failed: the list stays (unfiltered) and the field offers a retry.
  const [filterAttempt, setFilterAttempt] = useState(0);
  // Until "Retry", a failed build is not attempted again on every keystroke.
  const [filterFailure, setFilterFailure] = useState<{ forKey: string; attempt: number }>();
  const indexFailed =
    filterFailure !== undefined &&
    filterFailure.forKey === readyPager?.key &&
    filterFailure.attempt === filterAttempt;
  useEffect(() => {
    if (query === '' || !readyPager || indexFailed) return undefined;
    let cancelled = false;
    const { cache, key } = readyPager;
    cache.filterIndex().then(
      (index) => {
        if (cancelled) return;
        const keys = index.match(query);
        setFilterResult({
          forKey: key,
          query,
          key: `${key}\nfilter\n${query}`,
          cache: new PageCache(keysPager(keys)),
        });
        setAnnouncement(t.live.filter.results(keys.length));
      },
      (error: unknown) => {
        if (cancelled) return;
        log.warn('live: building the filter index failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
        setFilterFailure({ forKey: key, attempt: filterAttempt });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [query, readyPager, filterAttempt, indexFailed]);
  const filtering = query !== '';
  const filterFailed = filtering && indexFailed;
  const retryFilter = useCallback(() => setFilterAttempt((n) => n + 1), []);
  // The results of this pager (latest query first; an older query's results stay up meanwhile).
  const shownFilter =
    filtering && filterResult?.forKey === readyPager?.key ? filterResult : undefined;
  const readInitialView = useCallback((listKey: string) => viewMemory.current.get(listKey), []);

  const prefetchFilterIndex = useCallback(() => {
    if (!readyPager || indexFailed) return;
    const { cache, key } = readyPager;
    cache.filterIndex().catch(() => setFilterFailure({ forKey: key, attempt: filterAttempt }));
  }, [readyPager, indexFailed, filterAttempt]);

  const canSaveView = saved !== undefined && !wantsRestore && !filtering;
  const onViewChange = useCallback(
    (listKey: string, view: ChannelListView) => {
      if (sourceId === undefined || !canSaveView) return;
      viewMemory.current.set(listKey, { index: view.index, scrollTop: view.scrollTop });
      const record: SavedLiveView = {
        categoryId,
        selectedIndex: view.index,
        scrollTop: Math.max(0, Math.round(view.scrollTop)),
        savedAt: Date.now(),
      };
      if (view.key !== undefined) record.selectedKey = view.key;
      saver.schedule(sourceId, record);
    },
    [sourceId, canSaveView, categoryId, saver],
  );

  // --- EPG (EPG-01) --------------------------------------------------------------------------
  // One service per loaded source; leaving the screen (or the source) cancels what is in flight.
  const readySource = ready?.source;
  const epgService = useMemo(
    () => (readySource ? createEpgService(readySource) : undefined),
    [readySource],
  );
  useEffect(() => () => epgService?.cancel(), [epgService]);

  // --- playing channel (LIV-02) ------------------------------------------------------------
  const [selection, setSelection] = useState<Selection>();
  const [channelsOpen, setChannelsOpen] = useState(false);
  // Latest values for the zapping queue (it runs across renders).
  const selectionRef = useRef<Selection | undefined>(undefined);
  const pagerRef = useRef<PagerState | undefined>(undefined);
  const pagerKeyRef = useRef(pagerKey);
  useEffect(() => {
    pagerRef.current = currentPager;
    pagerKeyRef.current = pagerKey;
  });

  const select = useCallback(
    (channel: Channel, index: number | undefined, via: SelectionVia) => {
      const next: Selection = { channel, index, via, pagerKey: pagerKeyRef.current };
      selectionRef.current = next;
      setSelection(next);
      setAnnouncement(t.live.player.watching(channel.name));
      // Replace: picking or zapping channels must not stack one history entry per channel.
      navigate(liveChannelPath(categoryId, channel.key), { replace: true });
    },
    [navigate, categoryId],
  );

  // UX-07: a protected (DRM/DASH) channel is never opened in the player from the list — Play is
  // refused and the reason announced (the row shows the "Protected" badge and is aria-disabled).
  const refuseProtected = useCallback((channel: Channel): boolean => {
    if (!isProtectedItem(channel)) return false;
    setAnnouncement(t.state.protectedContent.unplayable);
    return true;
  }, []);

  // A filtered row's index is not its row in the category: zapping locates it instead.
  const onPlay = useCallback(
    (channel: Channel, index: number) => {
      if (refuseProtected(channel)) return;
      select(channel, filtering ? undefined : index, 'pick');
    },
    [select, filtering, refuseProtected],
  );

  // LIV-03: the last played channel ("Play last channel on open").
  const playedKey = selection?.channel.key;
  useEffect(() => {
    if (playedKey !== undefined) void saveLastChannel(playedKey);
  }, [playedKey]);

  const closePlayer = useCallback(() => {
    selectionRef.current = undefined;
    setSelection(undefined);
    setChannelsOpen(false);
    navigate(liveCategoryPath(categoryId), { replace: true });
  }, [navigate, categoryId]);

  // SRC-08 AC4: another list became active → close the player, leave a category of the previous
  // list (virtual ones are kept) and reload the categories. The first known value is not a change.
  const active = useActiveSource();
  const seenActive = useRef<{ id: string | undefined } | undefined>(undefined);
  useEffect(() => {
    if (!active.known) return;
    const previous = seenActive.current;
    seenActive.current = { id: active.id };
    if (previous === undefined || previous.id === active.id) return;
    selectionRef.current = undefined;
    setSelection(undefined);
    setChannelsOpen(false);
    const virtual = Object.values(LIVE_VIRTUAL_CATEGORY_IDS).includes(categoryId);
    if (!virtual || channelKey !== undefined) {
      navigate(liveCategoryPath(virtual ? categoryId : DEFAULT_CATEGORY_ID), { replace: true });
    }
    setSource({ status: 'loading' });
    setAttempt((n) => n + 1);
    // Only a change of the active list triggers this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.known, active.id]);

  // Restore (reload, deep link) or follow an outside change of `?channel=`.
  useEffect(() => {
    if (channelKey === undefined) {
      if (selectionRef.current) {
        selectionRef.current = undefined;
        setSelection(undefined);
      }
      return undefined;
    }
    if (sourceId === undefined || selectionRef.current?.channel.key === channelKey) {
      return undefined;
    }
    let cancelled = false;
    catalogRepo.get('live', channelKey).then(
      (channel) => {
        if (cancelled || selectionRef.current?.channel.key === channelKey) return;
        if (channel && channel.sourceId === sourceId) {
          const restored: Selection = {
            channel,
            index: undefined,
            via: 'restore',
            pagerKey: '',
          };
          selectionRef.current = restored;
          setSelection(restored);
        } else {
          // Gone after a sync, or from another list: nothing to restore.
          navigate({ search: '' }, { replace: true });
        }
      },
      (error: unknown) => {
        log.warn('live: restoring the channel failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [channelKey, sourceId, navigate]);

  // ↑/↓ and ⏮/⏭: previous/next channel of the current category. Steps run one after another
  // (each starts from the previous one's result), so fast presses never skip or repeat.
  const zapQueue = useRef<Promise<void>>(Promise.resolve());
  const zap = useCallback(
    (delta: 1 | -1) => {
      zapQueue.current = zapQueue.current
        .then(async () => {
          const from = selectionRef.current;
          const current = pagerRef.current;
          if (!from || current?.status !== 'ready') return;
          const index = from.pagerKey === current.key ? from.index : undefined;
          const next = await neighbour(current.cache, { channel: from.channel, index }, delta);
          // A pick (or close) while the neighbour was being read wins.
          if (!next || selectionRef.current !== from) return;
          select(next.channel, next.index, 'zap');
        })
        .catch((error: unknown) => {
          log.warn('live: zapping failed', {
            error: error instanceof Error ? error.name : 'unknown',
          });
        });
    },
    [select],
  );
  const onPrevious = useCallback(() => zap(-1), [zap]);
  const onNext = useCallback(() => zap(1), [zap]);
  const toggleChannels = useCallback(() => setChannelsOpen((open) => !open), []);
  const playerHandle = useRef<LivePlayerHandle>(null);
  const closeChannels = useCallback(() => {
    setChannelsOpen(false);
    // Back to the player, so its shortcuts keep working.
    playerHandle.current?.focus();
  }, []);
  const onOverlayPlay = useCallback(
    (channel: Channel, index: number) => {
      if (refuseProtected(channel)) return;
      select(channel, index, 'pick');
      closeChannels();
    },
    [select, closeChannels, refuseProtected],
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
  if (source.status === 'loading' || entry !== undefined) {
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
    const playing = channelKey !== undefined ? selection : undefined;
    // Tablet while playing: list | video, with the categories as chips above the list.
    const chips = !isTablet || (playing !== undefined && !isDesktop);
    const player = playing && (
      <Box
        sx={
          isTablet
            ? { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }
            : { position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.default' }
        }
      >
        <LivePlayer
          source={source.source}
          selection={playing}
          onPrevious={onPrevious}
          onNext={onNext}
          onToggleChannelList={toggleChannels}
          onClose={closePlayer}
          handleRef={playerHandle}
          overlay={
            channelsOpen &&
            readyPager &&
            category && (
              <ChannelsOverlay
                cache={readyPager.cache}
                pagerKey={readyPager.key}
                categoryName={category.name}
                favorites={favorites}
                playingKey={playing.channel.key}
                playingIndex={playing.pagerKey === readyPager.key ? playing.index : undefined}
                onPlay={onOverlayPlay}
                onToggleFavorite={onToggleFavorite}
                onClose={closeChannels}
              />
            )
          }
        />
        {epgService && <NowNext epg={epgService} channel={playing.channel} />}
      </Box>
    );
    const nav = (
      <CategoryNav
        categories={source.categories}
        selectedId={categoryId}
        variant={chips ? 'chips' : 'list'}
        label={t.live.categories}
        pathFor={liveCategoryPath}
        // Browsing categories keeps the channel playing.
        search={channelKey !== undefined ? liveChannelSearch(channelKey) : ''}
      />
    );
    const showFilter =
      category !== undefined &&
      readyPager !== undefined &&
      (readyPager.cache.total > 0 || filtering);
    const list = (
      <>
        {showFilter && (
          <ChannelFilterField
            value={filterText}
            onChange={setFilterText}
            listId={LIST_ID}
            onFocus={prefetchFilterIndex}
            failed={filterFailed}
            onRetry={retryFilter}
          />
        )}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            bgcolor: 'tokens.surface1',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <ChannelPane
            category={category}
            pager={currentPager}
            waiting={saved === undefined || wantsRestore}
            readInitialView={readInitialView}
            filter={filtering && !filterFailed ? (shownFilter ?? 'pending') : undefined}
            filterText={filterText}
            onClearFilter={() => setFilterText('')}
            onViewChange={onViewChange}
            epg={epgService}
            favorites={favorites}
            playingKey={channelKey}
            onPlay={onPlay}
            onToggleFavorite={onToggleFavorite}
            onPageError={onPageError}
            onRetry={() => setPagerAttempt((n) => n + 1)}
          />
        </Box>
      </>
    );
    const column = { display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 } as const;
    if (!isTablet) {
      content = (
        <Box sx={{ ...column, height: '100%' }}>
          {player}
          {nav}
          {list}
        </Box>
      );
    } else {
      content = (
        <Box
          sx={{
            height: '100%',
            display: 'grid',
            gap: 2,
            gridTemplateColumns: isDesktop
              ? '240px minmax(320px, 420px) 1fr'
              : playing
                ? 'minmax(280px, 2fr) 3fr'
                : '240px 1fr',
            gridTemplateRows: '100%',
            minHeight: 0,
          }}
        >
          {chips ? (
            <Box sx={{ ...column, height: '100%' }}>
              {nav}
              {list}
            </Box>
          ) : (
            <>
              <Box sx={{ height: '100%', minHeight: 0 }}>{nav}</Box>
              <Box sx={{ ...column, height: '100%' }}>{list}</Box>
            </>
          )}
          {player || (isDesktop && <PlayerPlaceholder />)}
        </Box>
      );
    }
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

/** DOM id of the main channel listbox (the filter field controls it). */
const LIST_ID = 'live-channel-list';

interface ChannelPaneProps {
  category: LiveCategory | undefined;
  pager: PagerState | undefined;
  /** The saved view is still being read/resolved (LIV-03): keep the skeleton. */
  waiting: boolean;
  /** Where the list of a pager key starts (read once, when it mounts). */
  readInitialView: (listKey: string) => ListPosition | undefined;
  /** Quick-filter results; 'pending' while the category's index is built (LIV-04). */
  filter: FilterResult | 'pending' | undefined;
  filterText: string;
  onClearFilter: () => void;
  onViewChange: (listKey: string, view: ChannelListView) => void;
  epg: EpgService | undefined;
  favorites: ReadonlySet<string>;
  playingKey: string | undefined;
  onPlay: (channel: Channel, index: number) => void;
  onToggleFavorite: (channel: Channel) => void;
  onPageError: (error: unknown) => void;
  onRetry: () => void;
}

function ChannelPane({
  category,
  pager,
  waiting,
  readInitialView,
  filter,
  filterText,
  onClearFilter,
  onViewChange,
  epg,
  favorites,
  playingKey,
  onPlay,
  onToggleFavorite,
  onPageError,
  onRetry,
}: ChannelPaneProps) {
  const showAll = (
    <Button
      variant="contained"
      component={Link}
      to={liveCategoryPath(LIVE_VIRTUAL_CATEGORY_IDS.all)}
    >
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
  if (pager?.status === 'error') return <LoadError error={pager.error} onRetry={onRetry} />;
  if (!pager || waiting || filter === 'pending') {
    return (
      <DelayedLoading>
        <ChannelListSkeleton />
      </DelayedLoading>
    );
  }
  if (filter) {
    if (filter.cache.total === 0) {
      return (
        <StateView
          variant="empty"
          title={t.live.filter.noMatches(filterText.trim())}
          actions={<Button onClick={onClearFilter}>{t.live.filter.clear}</Button>}
        />
      );
    }
    return (
      <ChannelList
        key={filter.key}
        id={LIST_ID}
        cache={filter.cache}
        label={t.live.channelsIn(category.name)}
        favorites={favorites}
        playingKey={playingKey}
        onPlay={onPlay}
        onToggleFavorite={onToggleFavorite}
        onError={onPageError}
        epg={epg}
      />
    );
  }
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
      id={LIST_ID}
      cache={pager.cache}
      label={t.live.channelsIn(category.name)}
      favorites={favorites}
      playingKey={playingKey}
      onPlay={onPlay}
      onToggleFavorite={onToggleFavorite}
      onError={onPageError}
      readInitialView={() => readInitialView(pager.key)}
      onViewChange={(view) => onViewChange(pager.key, view)}
      epg={epg}
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
