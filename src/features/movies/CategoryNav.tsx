// Category navigation of the Movies screen (VOD-01 AC1, docs/UX_UI.md §8): horizontal chips on
// mobile, a side list from 600 px. Each category is a link (`/movies/category/:categoryId`), so
// the selection is in the URL (deep links, Back) and `aria-current` marks it. Adapted from
// features/live/CategoryNav.tsx (features cannot import each other; candidate for extraction).
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { categoryPath, type MovieCategory } from './categories';

export interface CategoryNavProps {
  categories: readonly MovieCategory[];
  selectedId: string;
  variant: 'chips' | 'list';
  /** Query string kept on the category links (the sort order). */
  search?: string;
}

export function CategoryNav({ categories, selectedId, variant, search = '' }: CategoryNavProps) {
  const selectedChip = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const chip = selectedChip.current;
    if (variant === 'chips' && chip && typeof chip.scrollIntoView === 'function') {
      chip.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [variant, selectedId]);

  if (variant === 'chips') {
    return (
      <Box
        component="nav"
        aria-label={t.movies.categories}
        sx={{ overflowX: 'auto', flexShrink: 0, pb: 1 }}
      >
        <Box
          component="ul"
          sx={{ display: 'flex', gap: 1, m: 0, p: 0, listStyle: 'none', width: 'max-content' }}
        >
          {categories.map((c) => {
            const selected = c.id === selectedId;
            return (
              <li key={c.id}>
                <Chip
                  ref={selected ? selectedChip : undefined}
                  component={Link}
                  to={{ pathname: categoryPath(c.id), search }}
                  clickable
                  label={c.name}
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  aria-current={selected ? 'page' : undefined}
                  sx={{ minHeight: 44, borderRadius: 2 }}
                />
              </li>
            );
          })}
        </Box>
      </Box>
    );
  }
  return (
    <Box
      component="nav"
      aria-label={t.movies.categories}
      sx={{ height: '100%', overflowY: 'auto', bgcolor: 'tokens.surface1', borderRadius: 3 }}
    >
      <List dense>
        {categories.map((c) => {
          const selected = c.id === selectedId;
          return (
            <li key={c.id}>
              <ListItemButton
                component={Link}
                to={{ pathname: categoryPath(c.id), search }}
                selected={selected}
                aria-current={selected ? 'page' : undefined}
                sx={{ minHeight: 44 }}
              >
                <ListItemText primary={c.name} />
              </ListItemButton>
            </li>
          );
        })}
      </List>
    </Box>
  );
}
