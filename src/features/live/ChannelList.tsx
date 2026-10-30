// Virtualised channel list (LIV-01 AC2/AC4, docs/UX_UI.md §4.6 and §7).
//
// - Only the rows in (and just around) the viewport are in the DOM (`@tanstack/react-virtual`),
//   with a fixed 64 px row height, so 20 000 channels cost the same as 20.
// - Rows come from a `PageCache`: pages of 200 channels are read from IndexedDB as the viewport
//   reaches them; a row whose page is still loading renders as a placeholder.
// - Keyboard: a single tab stop (`role="listbox"`) with `aria-activedescendant`; options carry
//   `aria-setsize`/`aria-posinset` because most of them are not in the DOM.
// - LIV-03: the list can start at a saved scroll offset and reports its view (selection and
//   offset) so the screen can persist it.
// - EPG-01: with an EPG service, the visible rows (not the overscan) show their current programme;
//   it is requested once the viewport has been still for SCROLL_DEBOUNCE_MS.
import StarBorderRounded from '@mui/icons-material/StarBorderRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { isProtectedItem, type Channel } from '@/core/db';
import { t } from '@/i18n';
import { ProtectedBadge, ProtectedNote } from '@/ui/catalog/ProtectedBadge';
import { channelKeyOf } from '@/ui/dpad';
import { CHANNEL_ROW_HEIGHT, visuallyHidden } from '@/ui/state';
import { focusRing } from '@/ui/theme/tokens';
import { ChannelAvatar } from './ChannelAvatar';
import { currentProgramme, type EpgService } from './epg';
import type { PageCache } from './pageCache';
import { useVisibleEpg } from './useVisibleEpg';

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

/** Rows rendered above and below the viewport. */
export const OVERSCAN = 6;

export interface ChannelListProps {
  cache: PageCache;
  /** Accessible name of the listbox. */
  label: string;
  favorites: ReadonlySet<string>;
  /** Key of the channel currently playing (accent bar). */
  playingKey?: string | undefined;
  /** `index`: the channel's row in this list (zapping starts from it). */
  onPlay: (channel: Channel, index: number) => void;
  onToggleFavorite: (channel: Channel) => void;
  /** Loading a page failed. */
  onError?: (error: unknown) => void;
  /** Row selected (and scrolled to) on mount. Default 0. */
  initialIndex?: number | undefined;
  /** Focus the listbox on mount (e.g. the "Channels" panel). */
  focusOnMount?: boolean;
  /**
   * Where the list starts, read once on mount (LIV-03): the row and the scroll offset the user
   * last saw. Without an offset, the row is centred. Takes precedence over `initialIndex`.
   */
  readInitialView?: (() => { index: number; scrollTop?: number } | undefined) | undefined;
  /** Selection or scroll changed (LIV-03 persistence). */
  onViewChange?: ((view: ChannelListView) => void) | undefined;
  /** Current programme on the visible rows (EPG-01). */
  epg?: EpgService | undefined;
  /** DOM id of the listbox (so a filter field can point at it). */
  id?: string | undefined;
}

export interface ChannelListView {
  index: number;
  /** Key of the selected channel, when its page is loaded. */
  key: string | undefined;
  scrollTop: number;
}

export function ChannelList({
  cache,
  label,
  favorites,
  playingKey,
  onPlay,
  onToggleFavorite,
  onError,
  initialIndex = 0,
  focusOnMount = false,
  readInitialView,
  onViewChange,
  epg,
  id,
}: ChannelListProps) {
  const generatedId = useId();
  const listId = id ?? generatedId;
  const hintId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [initialView] = useState(() => readInitialView?.());
  const [selected, setActive] = useState(initialView?.index ?? initialIndex);
  // Clamped to the current total (the list may shrink under the selection).
  const active = Math.max(0, Math.min(cache.total - 1, selected));
  const [pageVersion, pageArrived] = useReducer((n: number) => n + 1, 0);
  const total = cache.total;

  useEffect(() => cache.subscribe(pageArrived, onError), [cache, onError]);

  // Always render the active row, even scrolled away, so `aria-activedescendant` stays valid.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (active < range.count && !indexes.includes(active)) {
        indexes.push(active);
        indexes.sort((a, b) => a - b);
      }
      return indexes;
    },
    [active],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer is the point
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CHANNEL_ROW_HEIGHT,
    overscan: OVERSCAN,
    rangeExtractor,
  });
  const rows = virtualizer.getVirtualItems();
  const visible = virtualizer.range;
  const firstIndex = Math.max(0, (visible?.startIndex ?? 0) - OVERSCAN);
  const lastIndex = visible ? visible.endIndex + OVERSCAN : -1;

  // This list's pin on the shared cache (another list may pin its own active row).
  const [pinOwner] = useState(() => ({}));
  useEffect(() => () => cache.pin(undefined, pinOwner), [cache, pinOwner]);

  // Fetch the pages covering the viewport (plus overscan) and the active row — two separate
  // ranges, so jumping with End does not fetch every page in between.
  useEffect(() => {
    // Pinning also loads the active row's page.
    cache.pin(active < total ? active : undefined, pinOwner);
    // Last, so eviction keeps the pages around the viewport.
    if (lastIndex >= 0) cache.setViewport(firstIndex, lastIndex);
  }, [cache, pinOwner, firstIndex, lastIndex, active, total]);

  // Mount only: start at the saved offset (LIV-03) or at the initial row (the playing channel in
  // the "Channels" panel).
  const initialActive = useRef(active);
  const initialTop = useRef(initialView?.scrollTop);
  useEffect(() => {
    const index = initialActive.current;
    const top = initialTop.current;
    if (top !== undefined) virtualizer.scrollToOffset(top);
    else if (index > 0) virtualizer.scrollToIndex(index, { align: 'center' });
    if (focusOnMount) scrollRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const move = (index: number) => {
    const next = Math.max(0, Math.min(total - 1, index));
    setActive(next);
    virtualizer.scrollToIndex(next, { align: 'auto' });
  };

  const pageRows = () =>
    Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / CHANNEL_ROW_HEIGHT));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (total === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    // UX-05: ↑ on the first row and ↓ on the last are left to the D-pad's spatial focus (the
    // filter field above, the controls below); the remote's channel keys page like PageUp/Down.
    const channelKey = channelKeyOf(event);
    switch (channelKey === 'up' ? 'PageUp' : channelKey === 'down' ? 'PageDown' : event.key) {
      case 'ArrowDown':
        if (active === total - 1) return;
        move(active + 1);
        break;
      case 'ArrowUp':
        if (active === 0) return;
        move(active - 1);
        break;
      case 'PageDown':
        move(active + pageRows());
        break;
      case 'PageUp':
        move(active - pageRows());
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(total - 1);
        break;
      case 'Enter': {
        const channel = cache.get(active);
        if (channel) onPlay(channel, active);
        break;
      }
      case 'f':
      case 'F': {
        const channel = cache.get(active);
        if (channel) onToggleFavorite(channel);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  // One handler for every row (event delegation): the star toggles, the rest of the row plays.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const row = target.closest<HTMLElement>('[data-index]');
    if (!row) return;
    const index = Number(row.dataset.index);
    const channel = cache.get(index);
    setActive(index);
    if (!channel) return;
    if (target.closest('[data-action="favorite"]')) onToggleFavorite(channel);
    else onPlay(channel, index);
  };

  // LIV-03: report the view (selection, scroll offset) on every change.
  const activeKey = cache.get(active)?.key;
  const reportRef = useRef(onViewChange);
  useEffect(() => {
    reportRef.current = onViewChange;
  });
  const viewRef = useRef({ index: active, key: activeKey });
  useEffect(() => {
    viewRef.current = { index: active, key: activeKey };
    if (total > 0) {
      reportRef.current?.({
        index: active,
        key: activeKey,
        scrollTop: scrollRef.current?.scrollTop ?? 0,
      });
    }
  }, [active, activeKey, total]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const onScroll = () =>
      reportRef.current?.({ ...viewRef.current, scrollTop: element.scrollTop });
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  const visibleStart = visible?.startIndex ?? 0;
  const visibleEnd = visible ? visible.endIndex : -1;
  const epgVersion = useVisibleEpg(epg, cache, visibleStart, visibleEnd, pageVersion);

  const activeRendered = rows.some((r) => r.index === active);

  return (
    <>
      <Box component="span" id={hintId} sx={visuallyHidden}>
        {t.live.keyboardHint}
      </Box>
      <Box
        ref={scrollRef}
        id={listId}
        role="listbox"
        aria-label={label}
        aria-describedby={hintId}
        aria-activedescendant={
          total > 0 && activeRendered ? `${listId}-option-${active}` : undefined
        }
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClick={onClick}
        data-testid="channel-list"
        sx={{
          height: '100%',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          position: 'relative',
          outline: 'none',
          '&:focus-visible [aria-selected="true"]': {
            outline: `${focusRing.width}px solid`,
            outlineColor: 'tokens.focusRing',
            outlineOffset: `-${focusRing.width + focusRing.offset}px`,
          },
        }}
      >
        {/* Inline height: it changes with every count, so no new CSS class per list size. */}
        <Box
          style={{ height: virtualizer.getTotalSize() }}
          sx={{ width: '100%', position: 'relative' }}
        >
          {rows.map((row) => {
            const channel = cache.get(row.index);
            return (
              <ChannelRow
                key={channel?.key ?? `pending-${row.index}`}
                id={`${listId}-option-${row.index}`}
                index={row.index}
                start={row.start}
                setSize={total}
                channel={channel}
                active={row.index === active}
                favorite={channel !== undefined && favorites.has(channel.key)}
                playing={channel !== undefined && channel.key === playingKey}
                now={channel && epg ? nowTitle(epg, channel, epgVersion) : undefined}
              />
            );
          })}
        </Box>
      </Box>
    </>
  );
}

/** Current programme title of `channel`, if cached (`_version` ties the call to a re-render). */
function nowTitle(epg: EpgService, channel: Channel, _version: number): string | undefined {
  return currentProgramme(epg.peek(channel), Date.now())?.title;
}

interface ChannelRowProps {
  id: string;
  index: number;
  start: number;
  setSize: number;
  channel: Channel | undefined;
  active: boolean;
  favorite: boolean;
  playing: boolean;
  /** Title of the programme on air (EPG-01). */
  now: string | undefined;
}

function ChannelRow({
  id,
  index,
  start,
  setSize,
  channel,
  active,
  favorite,
  playing,
  now,
}: ChannelRowProps) {
  // UX-07: marked, and announced as unavailable (Play is refused by the screen).
  const protectedContent = channel !== undefined && isProtectedItem(channel);
  return (
    <Box
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={protectedContent || undefined}
      data-protected={protectedContent || undefined}
      aria-setsize={setSize}
      aria-posinset={index + 1}
      aria-busy={channel === undefined || undefined}
      data-index={index}
      data-playing={playing || undefined}
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: CHANNEL_ROW_HEIGHT,
        transform: `translateY(${start}px)`,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        cursor: 'pointer',
        bgcolor: active ? 'tokens.surface3' : 'transparent',
        color: 'text.primary',
        '&:hover': { bgcolor: 'tokens.surface3' },
        // Accent bar on the left of the playing row (docs/UX_UI.md §4.6).
        ...(playing && { borderLeft: 3, borderColor: 'primary.main' }),
      }}
    >
      {channel === undefined ? (
        <>
          <Box component="span" sx={visuallyHidden}>
            {t.live.loadingRow}
          </Box>
          <Skeleton aria-hidden variant="rounded" width={40} height={40} />
          <Skeleton aria-hidden variant="text" sx={{ flex: 1 }} />
        </>
      ) : (
        <>
          <Box
            component="span"
            aria-hidden="true"
            sx={{
              minWidth: '3ch',
              color: 'text.secondary',
              typography: 'body2',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {channel.number ?? ''}
          </Box>
          <ChannelAvatar name={channel.name} logo={channel.logo} />
          <Box
            component="span"
            sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
          >
            <Box component="span" sx={ellipsis}>
              {channel.number !== undefined && (
                <Box component="span" sx={visuallyHidden}>
                  {`${channel.number} `}
                </Box>
              )}
              {channel.name}
              {favorite && (
                <Box component="span" sx={visuallyHidden}>
                  {`, ${t.live.favorite}`}
                </Box>
              )}
              {protectedContent && <ProtectedNote />}
            </Box>
            {now !== undefined && (
              // One muted line under the name (docs/UX_UI.md §4.6).
              <Box
                component="span"
                data-testid="row-now"
                sx={{ ...ellipsis, typography: 'body2', color: 'text.secondary' }}
              >
                <Box component="span" sx={visuallyHidden}>
                  {`, ${t.live.epg.rowNow} `}
                </Box>
                {now}
              </Box>
            )}
          </Box>
          {protectedContent && <ProtectedBadge labelled={false} />}
          {/* Mouse/touch target of the favourite toggle; keyboard users press F on the row. */}
          <Box
            component="span"
            data-action="favorite"
            aria-hidden="true"
            title={t.live.toggleFavorite(channel.name)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              flexShrink: 0,
              color: favorite ? 'primary.main' : 'text.secondary',
            }}
          >
            {favorite ? <StarRounded /> : <StarBorderRounded />}
          </Box>
        </>
      )}
    </Box>
  );
}
