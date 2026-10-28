// Category navigation (LIV-01 AC1, docs/UX_UI.md §4.3/§4.4): horizontal chips on mobile, a side
// list on tablet/desktop. Each category is a link to `/live/category/:categoryId`, so the
// selection is in the URL (deep links, back button) and `aria-current` marks it.
import StarRounded from '@mui/icons-material/StarRounded';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { categoryPath, type LiveCategory } from './categories';

export interface CategoryNavProps {
  categories: readonly LiveCategory[];
  selectedId: string;
  variant: 'chips' | 'list';
}

export function CategoryNav({ categories, selectedId, variant }: CategoryNavProps) {
  const selectedChip = useRef<HTMLAnchorElement>(null);
  // Mobile: keep the selected chip visible in the horizontal strip (deep links, Back).
  useEffect(() => {
    const chip = selectedChip.current;
    // jsdom (and very old engines) have no scrollIntoView.
    if (variant === 'chips' && chip && typeof chip.scrollIntoView === 'function') {
      chip.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [variant, selectedId]);

  if (variant === 'chips') {
    return (
      <Box
        component="nav"
        aria-label={t.live.categories}
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
                  to={categoryPath(c.id)}
                  clickable
                  label={c.name}
                  icon={c.kind === 'favorites' ? <StarRounded aria-hidden /> : undefined}
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
      aria-label={t.live.categories}
      sx={{ height: '100%', overflowY: 'auto', bgcolor: 'tokens.surface1', borderRadius: 3 }}
    >
      <List dense>
        {categories.map((c) => {
          const selected = c.id === selectedId;
          return (
            <li key={c.id}>
              <ListItemButton
                component={Link}
                to={categoryPath(c.id)}
                selected={selected}
                aria-current={selected ? 'page' : undefined}
                sx={{ minHeight: 44 }}
              >
                {c.kind === 'favorites' && (
                  <StarRounded aria-hidden fontSize="small" sx={{ mr: 1 }} />
                )}
                <ListItemText primary={c.name} />
              </ListItemButton>
            </li>
          );
        })}
      </List>
    </Box>
  );
}
