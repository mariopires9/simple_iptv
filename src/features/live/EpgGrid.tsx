// TV guide grid (EPG-04): channels as rows, time on the horizontal axis.
//
// - Virtualised on both axes (`@tanstack/react-virtual`, one scroll element): only the rows in
//   (and around) the viewport are in the DOM, and in each row only the programmes overlapping
//   the 30-minute slots in (and around) the viewport. 2 000 channels × 48 h cost about the same
//   as 20 × 3 h.
// - Rows come from a `PageCache` (pages read from IndexedDB as the viewport reaches them); the
//   programmes of the visible rows are asked once the viewport has been still (`useVisibleEpg`).
// - Sticky time header and channel column; a vertical "now" line moves with the clock.
// - Keyboard: a single tab stop (`role="grid"`) with `aria-activedescendant`. Left/Right move
//   programme to programme (30-minute steps across stretches without guide information), Up/Down
//   keep the time and change channel, Home goes back to now, Enter opens the programme (or plays
//   the channel on an empty stretch).
// - Programme text is untrusted: rendered as React text only.
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import {
  memo,
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
import { CHANNEL_ROW_HEIGHT, visuallyHidden } from '@/ui/state';
import { focusRing } from '@/ui/theme/tokens';
import type { EpgService, ShortEpgProgramme } from './epg';
import { formatDay, formatTime } from './epgFormat';
import {
  SLOT_MS,
  SLOT_PX,
  cellAt,
  clampToWindow,
  moveAlongRow,
  overlapping,
  slotCount,
  xOf,
  type GuideCell,
  type GuideWindow,
} from './guideLayout';
import type { PageCache } from './pageCache';
import { useVisibleEpg } from './useVisibleEpg';

export const GUIDE_ROW_HEIGHT = CHANNEL_ROW_HEIGHT;
export const GUIDE_HEADER_HEIGHT = 40;
/** Rows rendered above and below the viewport. */
export const ROW_OVERSCAN = 4;
/** 30-minute slots rendered left and right of the viewport. */
export const SLOT_OVERSCAN = 2;

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

export interface EpgGridProps {
  cache: PageCache;
  epg: EpgService | undefined;
  span: GuideWindow;
  /** Current time (the screen ticks it). */
  now: number;
  /** Accessible name of the grid. */
  label: string;
  /** Width of the sticky channel column (px). */
  channelWidth: number;
  onPlay: (channel: Channel) => void;
  onOpen: (channel: Channel, programme: ShortEpgProgramme) => void;
  /** Loading a page failed. */
  onError?: (error: unknown) => void;
}

interface Active {
  row: number;
  /** Anchor time: the active cell is the one containing it. */
  time: number;
}

export function EpgGrid({
  cache,
  epg,
  span,
  now,
  label,
  channelWidth,
  onPlay,
  onOpen,
  onError,
}: EpgGridProps) {
  const gridId = useId();
  const hintId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const total = cache.total;
  const [pageVersion, pageArrived] = useReducer((n: number) => n + 1, 0);
  useEffect(() => cache.subscribe(pageArrived, onError), [cache, onError]);

  const [active, setActive] = useState<Active>(() => ({
    row: 0,
    time: clampToWindow(now, span),
  }));
  const activeRow = Math.max(0, Math.min(total - 1, active.row));

  // Always render the active row, even scrolled away, so `aria-activedescendant` stays valid.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (activeRow < range.count && !indexes.includes(activeRow)) {
        indexes.push(activeRow);
        indexes.sort((a, b) => a - b);
      }
      return indexes;
    },
    [activeRow],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer is the point
  const rows = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GUIDE_ROW_HEIGHT,
    overscan: ROW_OVERSCAN,
    paddingStart: GUIDE_HEADER_HEIGHT,
    scrollPaddingStart: GUIDE_HEADER_HEIGHT,
    rangeExtractor,
  });
  const slots = useVirtualizer({
    horizontal: true,
    count: slotCount(span),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SLOT_PX,
    overscan: SLOT_OVERSCAN,
    paddingStart: channelWidth,
    scrollPaddingStart: channelWidth,
  });
  const rowItems = rows.getVirtualItems();
  const slotItems = slots.getVirtualItems();
  const firstSlot = slotItems[0]?.index ?? 0;
  const lastSlot = slotItems[slotItems.length - 1]?.index ?? 0;
  // Programmes overlapping these instants are rendered.
  const from = span.start + firstSlot * SLOT_MS;
  const to = span.start + (lastSlot + 1) * SLOT_MS;

  const visible = rows.range;
  const firstIndex = Math.max(0, (visible?.startIndex ?? 0) - ROW_OVERSCAN);
  const lastIndex = visible ? visible.endIndex + ROW_OVERSCAN : -1;
  const [pinOwner] = useState(() => ({}));
  useEffect(() => () => cache.pin(undefined, pinOwner), [cache, pinOwner]);
  useEffect(() => {
    cache.pin(activeRow < total ? activeRow : undefined, pinOwner);
    if (lastIndex >= 0) cache.setViewport(firstIndex, lastIndex);
  }, [cache, pinOwner, firstIndex, lastIndex, activeRow, total]);

  const epgVersion = useVisibleEpg(
    epg,
    cache,
    visible?.startIndex ?? 0,
    visible ? visible.endIndex : -1,
    pageVersion,
  );

  // Mount only: the timeline starts half an hour before now.
  const initialNow = useRef(now);
  useEffect(() => {
    const element = scrollRef.current;
    const left = Math.max(0, xOf(initialNow.current - SLOT_MS, span));
    element?.scrollTo({ left });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const programmesOf = (row: number): ShortEpgProgramme[] => {
    const channel = cache.get(row);
    return channel && epg ? overlapping(epg.peek(channel), span.start, span.end) : [];
  };

  /** Scrolls (both axes) so that the cell at (`row`, `time`) is in view. */
  const reveal = (row: number, time: number) => {
    rows.scrollToIndex(row, { align: 'auto' });
    const element = scrollRef.current;
    if (!element) return;
    const cell = cellAt(programmesOf(row), time, span);
    const x0 = xOf(cell.start, span);
    const x1 = xOf(cell.end, span);
    const viewport = Math.max(0, element.clientWidth - channelWidth);
    const left = element.scrollLeft;
    if (x0 < left) element.scrollTo({ left: x0 });
    else if (x1 > left + viewport) element.scrollTo({ left: Math.min(x0, x1 - viewport) });
  };

  const moveTo = (row: number, time: number) => {
    const next = {
      row: Math.max(0, Math.min(total - 1, row)),
      time: clampToWindow(time, span),
    };
    setActive(next);
    reveal(next.row, next.time);
  };

  const pageRows = () =>
    Math.max(
      1,
      Math.floor(((scrollRef.current?.clientHeight ?? 0) - GUIDE_HEADER_HEIGHT) / GUIDE_ROW_HEIGHT),
    );

  const activate = (row: number, cell: GuideCell) => {
    const channel = cache.get(row);
    if (!channel) return;
    if (cell.kind === 'programme') onOpen(channel, cell.programme);
    else onPlay(channel);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (total === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const time = clampToWindow(active.time, span);
    switch (event.key) {
      case 'ArrowRight':
        moveTo(activeRow, moveAlongRow(programmesOf(activeRow), time, 1, span));
        break;
      case 'ArrowLeft':
        moveTo(activeRow, moveAlongRow(programmesOf(activeRow), time, -1, span));
        break;
      case 'ArrowDown':
        moveTo(activeRow + 1, time);
        break;
      case 'ArrowUp':
        moveTo(activeRow - 1, time);
        break;
      case 'PageDown':
        moveTo(activeRow + pageRows(), time);
        break;
      case 'PageUp':
        moveTo(activeRow - pageRows(), time);
        break;
      case 'Home':
        moveTo(activeRow, now);
        break;
      case 'Enter':
        activate(activeRow, cellAt(programmesOf(activeRow), time, span));
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // One handler for every cell (event delegation).
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const rowElement = target.closest<HTMLElement>('[data-row]');
    if (!rowElement) return;
    const row = Number(rowElement.dataset.row);
    const channel = cache.get(row);
    if (!channel) return;
    const cellElement = target.closest<HTMLElement>('[data-start]');
    if (cellElement) {
      const time = Number(cellElement.dataset.start);
      setActive({ row, time });
      activate(row, cellAt(programmesOf(row), time, span));
      return;
    }
    if (target.closest('[data-action="play"]')) onPlay(channel);
  };

  const activeTime = clampToWindow(active.time, span);
  const activeCell = cellAt(programmesOf(activeRow), activeTime, span);
  const activeId = cellId(gridId, activeRow, activeCell);
  const activeRendered = rowItems.some((r) => r.index === activeRow);
  const width = slots.getTotalSize();
  const height = rows.getTotalSize();
  const showNow = now >= span.start && now < span.end;

  return (
    <>
      <Box component="span" id={hintId} sx={visuallyHidden}>
        {t.live.guide.keyboardHint}
      </Box>
      <Box
        ref={scrollRef}
        role="grid"
        aria-label={label}
        aria-describedby={hintId}
        aria-rowcount={total + 1}
        aria-activedescendant={total > 0 && activeRendered ? activeId : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClick={onClick}
        data-testid="epg-grid"
        sx={{
          height: '100%',
          overflow: 'auto',
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
        {/* Inline sizes: they change with every list, so no new CSS class per size. */}
        <Box style={{ width, height }} sx={{ position: 'relative' }}>
          <TimeHeader
            items={slotItems}
            span={span}
            width={width}
            channelWidth={channelWidth}
            now={showNow ? now : undefined}
          />
          {showNow && (
            <Box
              aria-hidden="true"
              data-testid="epg-now-line"
              style={{ left: channelWidth + xOf(now, span), height }}
              sx={{
                position: 'absolute',
                top: 0,
                width: 2,
                bgcolor: 'tokens.live',
                zIndex: 1,
                pointerEvents: 'none',
              }}
            />
          )}
          {rowItems.map((item) => {
            const channel = cache.get(item.index);
            const isActive = item.index === activeRow;
            return (
              <GuideRow
                key={channel?.key ?? `pending-${item.index}`}
                gridId={gridId}
                index={item.index}
                top={item.start}
                width={width}
                channelWidth={channelWidth}
                channel={channel}
                programmes={channel && epg ? epg.peek(channel) : undefined}
                epgVersion={epgVersion}
                span={span}
                from={from}
                to={to}
                now={now}
                activeTime={isActive ? activeTime : undefined}
              />
            );
          })}
        </Box>
      </Box>
    </>
  );
}

function cellId(gridId: string, row: number, cell: GuideCell): string {
  return cell.kind === 'programme' ? `${gridId}-${row}-${cell.start}` : `${gridId}-${row}-gap`;
}

interface TimeHeaderProps {
  items: readonly { index: number; start: number }[];
  span: GuideWindow;
  width: number;
  channelWidth: number;
  now: number | undefined;
}

function TimeHeader({ items, span, width, channelWidth, now }: TimeHeaderProps) {
  return (
    <Box
      role="row"
      aria-rowindex={1}
      style={{ width }}
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 3,
        height: GUIDE_HEADER_HEIGHT,
        bgcolor: 'tokens.surface2',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Box
        role="columnheader"
        style={{ width: channelWidth }}
        sx={{
          position: 'sticky',
          left: 0,
          zIndex: 4,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          px: 2,
          typography: 'body2',
          color: 'text.secondary',
          bgcolor: 'tokens.surface2',
        }}
      >
        {t.live.guide.channels}
      </Box>
      {items.map((item) => {
        const time = span.start + item.index * SLOT_MS;
        const midnight = new Date(time).getHours() === 0 && new Date(time).getMinutes() === 0;
        return (
          <Box
            key={item.index}
            role="columnheader"
            style={{ left: item.start, width: SLOT_PX }}
            sx={{
              position: 'absolute',
              top: 0,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 1,
              borderLeft: 1,
              borderColor: 'divider',
              typography: 'body2',
              fontVariantNumeric: 'tabular-nums',
              color: 'text.secondary',
              whiteSpace: 'nowrap',
            }}
          >
            {(midnight || item.index === 0) && (
              <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
                {formatDay(time)}
              </Box>
            )}
            {formatTime(time)}
          </Box>
        );
      })}
      {now !== undefined && (
        <Box
          component="span"
          aria-hidden="true"
          style={{ left: channelWidth + xOf(now, span) }}
          sx={{
            position: 'absolute',
            bottom: 0,
            transform: 'translateX(-50%)',
            px: 0.5,
            borderRadius: 1,
            typography: 'caption',
            bgcolor: 'tokens.live',
            color: 'common.white',
          }}
        >
          {t.live.guide.nowLine}
        </Box>
      )}
    </Box>
  );
}

interface GuideRowProps {
  gridId: string;
  index: number;
  top: number;
  width: number;
  channelWidth: number;
  channel: Channel | undefined;
  /** The channel's cached programmes (stable reference while cached). */
  programmes: readonly ShortEpgProgramme[] | undefined;
  /** Ties the row to EPG arrivals (memo). */
  epgVersion: number;
  span: GuideWindow;
  /** Programmes overlapping `[from, to)` are rendered (horizontal virtualisation). */
  from: number;
  to: number;
  now: number;
  /** Anchor time when this is the active row. */
  activeTime: number | undefined;
}

const GuideRow = memo(function GuideRow({
  gridId,
  index,
  top,
  width,
  channelWidth,
  channel,
  programmes,
  span,
  from,
  to,
  now,
  activeTime,
}: GuideRowProps) {
  const protectedContent = channel !== undefined && isProtectedItem(channel);
  const list = overlapping(programmes, span.start, span.end);
  const cells: GuideCell[] = [];
  for (const p of list) {
    if (p.start < to && p.end > from) {
      cells.push({
        kind: 'programme',
        programme: p,
        start: Math.max(p.start, span.start),
        end: Math.min(p.end, span.end),
      });
    }
  }
  const active = activeTime !== undefined ? cellAt(list, activeTime, span) : undefined;
  if (active?.kind === 'programme' && !cells.some((c) => c.start === active.start)) {
    cells.push(active);
  }
  const activeId = active && cellId(gridId, index, active);

  return (
    <Box
      role="row"
      aria-rowindex={index + 2}
      aria-busy={channel === undefined || undefined}
      data-row={index}
      style={{ width, transform: `translateY(${top}px)` }}
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        height: GUIDE_ROW_HEIGHT,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Box
        role="rowheader"
        data-action="play"
        title={channel ? t.live.guide.channel(channel.name) : undefined}
        style={{ width: channelWidth }}
        sx={{
          position: 'sticky',
          left: 0,
          zIndex: 2,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          cursor: channel ? 'pointer' : undefined,
          bgcolor: 'tokens.surface1',
          borderRight: 1,
          borderColor: 'divider',
          '&:hover': { bgcolor: 'tokens.surface3' },
        }}
      >
        {channel === undefined ? (
          <>
            <Box component="span" sx={visuallyHidden}>
              {t.live.loadingRow}
            </Box>
            <Skeleton aria-hidden variant="text" sx={{ flex: 1 }} />
          </>
        ) : (
          <>
            {channel.number !== undefined && (
              <Box
                component="span"
                sx={{
                  color: 'text.secondary',
                  typography: 'body2',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {channel.number}
              </Box>
            )}
            <Box component="span" sx={{ ...ellipsis, flex: 1, minWidth: 0 }}>
              {channel.name}
              {protectedContent && <ProtectedNote />}
            </Box>
            {protectedContent && <ProtectedBadge labelled={false} />}
          </>
        )}
      </Box>
      {programmes !== undefined && list.length === 0 && (
        <Box
          component="span"
          aria-hidden="true"
          style={{ left: channelWidth + xOf(Math.max(from, span.start), span) }}
          sx={{
            position: 'absolute',
            top: 0,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            px: 2,
            typography: 'body2',
            color: 'text.secondary',
            whiteSpace: 'nowrap',
          }}
        >
          {t.live.guide.noInfo}
        </Box>
      )}
      {cells.map((cell) =>
        cell.kind === 'programme' ? (
          <ProgrammeCell
            key={cell.start}
            id={cellId(gridId, index, cell)}
            cell={cell}
            span={span}
            channelWidth={channelWidth}
            onNow={cell.programme.start <= now && now < cell.programme.end}
            selected={cellId(gridId, index, cell) === activeId}
          />
        ) : null,
      )}
      {active?.kind === 'gap' && channel && (
        <Box
          id={activeId}
          role="gridcell"
          aria-selected="true"
          aria-label={t.live.guide.gap(
            channel.name,
            formatTime(active.start),
            formatTime(active.end),
          )}
          data-start={active.start}
          style={{
            left: channelWidth + xOf(active.start, span),
            width: Math.max(1, xOf(active.end, span) - xOf(active.start, span)),
          }}
          sx={{ position: 'absolute', top: 0, height: '100%', bgcolor: 'tokens.surface3' }}
        />
      )}
    </Box>
  );
});

interface ProgrammeCellProps {
  id: string;
  cell: Extract<GuideCell, { kind: 'programme' }>;
  span: GuideWindow;
  channelWidth: number;
  onNow: boolean;
  selected: boolean;
}

function ProgrammeCell({ id, cell, span, channelWidth, onNow, selected }: ProgrammeCellProps) {
  const { programme } = cell;
  const start = formatTime(programme.start);
  const end = formatTime(programme.end);
  const left = xOf(cell.start, span);
  return (
    <Box
      id={id}
      role="gridcell"
      aria-selected={selected}
      aria-label={t.live.guide.cell(programme.title, start, end, onNow)}
      data-start={cell.start}
      data-now={onNow || undefined}
      style={{ left: channelWidth + left, width: Math.max(1, xOf(cell.end, span) - left) }}
      sx={{
        position: 'absolute',
        top: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        px: 1,
        overflow: 'hidden',
        cursor: 'pointer',
        borderLeft: 1,
        borderColor: 'divider',
        bgcolor: selected ? 'tokens.surface3' : onNow ? 'tokens.surface2' : 'transparent',
        '&:hover': { bgcolor: 'tokens.surface3' },
      }}
    >
      <Box component="span" aria-hidden="true" sx={{ ...ellipsis, typography: 'body2' }}>
        {programme.title}
      </Box>
      <Box
        component="span"
        aria-hidden="true"
        sx={{
          ...ellipsis,
          typography: 'caption',
          color: 'text.secondary',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {t.live.epg.times(start, end)}
      </Box>
    </Box>
  );
}
