// Virtualised poster grid (VOD-01 AC1/AC3/AC4, docs/UX_UI.md §4.6, §7, §8).
//
// - Rows of N posters, N from the available width: 3 on mobile, 4–6 on tablet, 6–8 on desktop.
//   Only the rows in (and just around) the viewport are in the DOM (`@tanstack/react-virtual`).
// - Movies come from a `MoviePageCache` (pages read by key as the viewport reaches them); a cell
//   whose page is still loading renders as a placeholder.
// - Keyboard: ARIA grid with a roving tab stop — one cell is tabbable, arrows move between cells
//   (and scroll), Home/End jump to the first/last movie, Enter opens the focused movie's details.
//   `aria-rowcount`/`aria-rowindex` describe the full grid even though most rows are not in DOM.
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Link } from 'react-router';
import type { Movie } from '@/core/db';
import { t } from '@/i18n';
import { visuallyHidden } from '@/ui/state';
import { focusRing, radii } from '@/ui/theme/tokens';
import { moviePath } from './categories';
import { formatPercent } from './format';
import type { MoviePageCache } from './pageCache';
import { Poster } from './Poster';

/** Rows rendered above and below the viewport. */
export const OVERSCAN = 2;
/** Gap between posters (px). */
export const GAP = 16;
/** Height of the text under a poster: two title lines + the year + spacing (px). */
export const CAPTION_HEIGHT = 72;

export type GridBand = 'mobile' | 'tablet' | 'desktop';

/** Poster widths of docs/UX_UI.md §4.6 per band, used to choose the column count. */
const BANDS: Readonly<Record<GridBand, { min: number; max: number; width: number }>> = {
  mobile: { min: 3, max: 3, width: 112 },
  tablet: { min: 4, max: 6, width: 144 },
  desktop: { min: 6, max: 8, width: 168 },
};

/** Columns for a grid `width` px wide in a viewport `band`. */
export function columnsFor(width: number, band: GridBand): number {
  const { min, max, width: poster } = BANDS[band];
  const fit = Math.floor((width + GAP) / (poster + GAP));
  return Math.max(min, Math.min(max, fit));
}

/** Width of one poster for `columns` in `width` px. */
export function cellWidth(width: number, columns: number): number {
  return Math.max(1, (width - GAP * (columns - 1)) / columns);
}

export interface MovieGridProps {
  cache: MoviePageCache;
  /** Accessible name of the grid. */
  label: string;
  band: GridBand;
  /** Watched fraction per movie key ("Continue watching" bars). */
  progress: ReadonlyMap<string, number>;
  /** Loading a page failed. */
  onError?: (error: unknown) => void;
}

/** Width of the scroll container (ResizeObserver when available; jsdom has none). */
function useWidth(el: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return undefined;
    const update = () => setWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return width;
}

export function MovieGrid({ cache, label, band, progress, onError }: MovieGridProps) {
  const gridId = useId();
  const hintId = useId();
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);
  const width = useWidth(scrollEl);
  const columns = columnsFor(width, band);
  const posterWidth = cellWidth(width, columns);
  const rowHeight = Math.round(posterWidth * 1.5) + CAPTION_HEIGHT + GAP;
  const total = cache.total;
  const rowCount = Math.ceil(total / columns);

  const [selected, setActive] = useState(0);
  const active = Math.max(0, Math.min(total - 1, selected));
  const activeRow = Math.floor(active / columns);
  const [, pageArrived] = useReducer((n: number) => n + 1, 0);
  useEffect(() => cache.subscribe(pageArrived, onError), [cache, onError]);

  // Always render the active row, even scrolled away, so the grid keeps its tab stop.
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
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    rangeExtractor,
  });
  // New column count or poster size: every row has a new height.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowHeight, columns]);

  const rows = virtualizer.getVirtualItems();
  const visible = virtualizer.range;
  const firstItem = Math.max(0, (visible?.startIndex ?? 0) - OVERSCAN) * columns;
  const lastItem = visible ? (visible.endIndex + OVERSCAN + 1) * columns - 1 : -1;

  useEffect(() => {
    if (active < total) cache.ensure(active, active);
    if (lastItem >= 0) cache.ensure(firstItem, Math.min(total - 1, lastItem));
  }, [cache, firstItem, lastItem, active, total]);

  // Focus follows keyboard moves once the target cell is rendered.
  const pendingFocus = useRef<number | undefined>(undefined);
  useEffect(() => {
    const index = pendingFocus.current;
    if (index === undefined) return;
    const grid = scrollRef.current;
    const cell = grid?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!grid || !cell) return;
    // Focus went elsewhere (Tab, a click outside) meanwhile: do not steal it back.
    const current = document.activeElement;
    if (current && current !== document.body && !grid.contains(current)) {
      pendingFocus.current = undefined;
      return;
    }
    cell.focus({ preventScroll: true });
    // A placeholder is replaced by the movie's link when its page arrives: keep following it.
    if (cell.getAttribute('aria-busy') !== 'true') pendingFocus.current = undefined;
  });

  const move = (index: number) => {
    const next = Math.max(0, Math.min(total - 1, index));
    setActive(next);
    pendingFocus.current = next;
    virtualizer.scrollToIndex(Math.floor(next / columns), { align: 'auto' });
  };

  const pageRows = () =>
    Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / rowHeight));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (total === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowRight':
        move(active + 1);
        break;
      case 'ArrowLeft':
        move(active - 1);
        break;
      case 'ArrowDown':
        move(active + columns);
        break;
      case 'ArrowUp':
        move(active - columns);
        break;
      case 'PageDown':
        move(active + columns * pageRows());
        break;
      case 'PageUp':
        move(active - columns * pageRows());
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(total - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <>
      <Box component="span" id={hintId} sx={visuallyHidden}>
        {t.movies.keyboardHint}
      </Box>
      <Box
        ref={setScroll}
        id={gridId}
        role="grid"
        aria-label={label}
        aria-describedby={hintId}
        aria-rowcount={rowCount}
        aria-colcount={columns}
        onKeyDown={onKeyDown}
        data-testid="movie-grid"
        sx={{
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
          position: 'relative',
        }}
      >
        <Box sx={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {width > 0 &&
            rows.map((row) => (
              <Box
                key={row.key}
                role="row"
                aria-rowindex={row.index + 1}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  columnGap: `${GAP}px`,
                }}
                style={{ transform: `translateY(${row.start}px)`, height: rowHeight - GAP }}
              >
                {Array.from({ length: columns }, (_, column) => {
                  const index = row.index * columns + column;
                  if (index >= total) return null;
                  const movie = cache.get(index);
                  return (
                    <Box
                      key={column}
                      role="gridcell"
                      aria-colindex={column + 1}
                      sx={{ minWidth: 0 }}
                    >
                      <PosterCard
                        index={index}
                        movie={movie}
                        width={posterWidth}
                        tabbable={index === active}
                        progress={movie ? progress.get(movie.key) : undefined}
                        onFocus={setActive}
                      />
                    </Box>
                  );
                })}
              </Box>
            ))}
        </Box>
      </Box>
    </>
  );
}

interface PosterCardProps {
  index: number;
  movie: Movie | undefined;
  width: number;
  tabbable: boolean;
  progress: number | undefined;
  onFocus: (index: number) => void;
}

const cardSx = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0.5,
  color: 'text.primary',
  textDecoration: 'none',
  borderRadius: `${radii.md}px`,
  outline: 'none',
  '&:focus-visible': {
    outline: `${focusRing.width}px solid`,
    outlineColor: 'tokens.focusRing',
    outlineOffset: `${focusRing.offset}px`,
  },
  '&:hover .poster-title': { textDecoration: 'underline' },
} as const;

function PosterCard({ index, movie, width, tabbable, progress, onFocus }: PosterCardProps) {
  if (!movie) {
    return (
      <Box
        data-index={index}
        tabIndex={tabbable ? 0 : -1}
        aria-busy="true"
        onFocus={() => onFocus(index)}
        sx={cardSx}
      >
        <Box component="span" sx={visuallyHidden}>
          {t.movies.loadingCard}
        </Box>
        <Skeleton
          aria-hidden
          variant="rounded"
          sx={{ width: '100%', height: 'auto', aspectRatio: '2 / 3' }}
        />
        <Skeleton aria-hidden variant="text" width="80%" />
      </Box>
    );
  }
  return (
    <Box
      component={Link}
      to={moviePath(movie.externalId)}
      data-index={index}
      tabIndex={tabbable ? 0 : -1}
      onFocus={() => onFocus(index)}
      sx={cardSx}
    >
      <Poster title={movie.name} url={movie.poster} width={width} progress={progress} />
      <Box
        component="span"
        className="poster-title"
        sx={{
          typography: 'body2',
          fontWeight: 600,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          wordBreak: 'break-word',
        }}
      >
        {movie.name}
      </Box>
      {movie.year !== undefined && (
        <Box
          component="span"
          sx={{
            typography: 'caption',
            color: 'text.secondary',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {movie.year}
        </Box>
      )}
      {progress !== undefined && (
        <Box component="span" sx={visuallyHidden}>
          {`, ${t.movies.watched(formatPercent(progress))}`}
        </Box>
      )}
    </Box>
  );
}
