// A Home section (FAV-03 AC1): heading, optional "See all" link and a horizontally scrollable row
// of cards. The row is one tab stop (roving tabindex, docs/UX_UI.md §7): arrow keys move between
// cards, Home/End jump to the ends, and the focused card is scrolled into view.
import Box from '@mui/material/Box';
import MuiLink from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { useId, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { CARD_WIDTH, ItemCard } from './ItemCard';
import type { CardItem } from './data';

export interface ShelfProps {
  title: string;
  items: readonly CardItem[];
  /** Route of the full list ("See all"). */
  seeAllHref?: string | undefined;
}

const MOVES: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowRight: (i, last) => Math.min(i + 1, last),
  ArrowLeft: (i) => Math.max(i - 1, 0),
  Home: () => 0,
  End: (_i, last) => last,
};

export function Shelf({ title, items, seeAllHref }: ShelfProps) {
  const headingId = useId();
  const hintId = useId();
  const [active, setActive] = useState(0);
  const current = Math.min(active, items.length - 1);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const move = MOVES[event.key];
    if (!move || event.altKey || event.ctrlKey || event.metaKey) return;
    const links = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-card-link]')];
    const from = links.findIndex((link) => link === document.activeElement);
    if (from < 0) return;
    event.preventDefault();
    const next = links[move(from, links.length - 1)];
    if (!next) return;
    next.focus();
    next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  return (
    <Box component="section" aria-labelledby={headingId} sx={{ mb: 4 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1,
          mb: 1.5,
        }}
      >
        <Typography id={headingId} variant="h5" component="h2">
          {title}
        </Typography>
        {seeAllHref !== undefined && (
          <MuiLink
            component={Link}
            to={seeAllHref}
            aria-label={t.favorites.seeAllLabel(title)}
            sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
          >
            {t.favorites.seeAll}
          </MuiLink>
        )}
      </Box>
      <Box component="span" id={hintId} hidden>
        {t.favorites.rowHint}
      </Box>
      <Box
        component="ul"
        // Explicit: some screen readers drop the list role of a `list-style: none` list.
        role="list"
        aria-labelledby={headingId}
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        sx={{
          display: 'flex',
          gap: 2,
          listStyle: 'none',
          m: 0,
          p: 0.5,
          overflowX: 'auto',
          scrollSnapType: 'x proximity',
          scrollbarWidth: 'thin',
        }}
      >
        {items.map((item, index) => (
          <Box
            component="li"
            key={item.key}
            sx={{ flex: '0 0 auto', width: CARD_WIDTH, scrollSnapAlign: 'start' }}
          >
            <ItemCard
              item={item}
              tabIndex={index === current ? 0 : -1}
              onFocus={() => setActive(index)}
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
