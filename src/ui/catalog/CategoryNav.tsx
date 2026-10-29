// Category navigation of the catalogue screens (LIV-01 AC1, VOD-01 AC1, docs/UX_UI.md §4.3/§4.4,
// §8): horizontal chips on mobile, a side list on tablet/desktop. Each category is a link (the
// feature gives its route path), so the selection is in the URL (deep links, back button) and
// `aria-current` marks it. Shared since TEC-02: the accessible name comes from the feature, so this
// component reads no feature strings.
import StarRounded from '@mui/icons-material/StarRounded';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';

/** A navigable category. `kind: 'favorites'` gets a star icon. */
export interface NavCategory {
  kind: string;
  id: string;
  name: string;
}

export interface CategoryNavProps {
  categories: readonly NavCategory[];
  selectedId: string;
  variant: 'chips' | 'list';
  /** Accessible name of the navigation landmark (e.g. "Categories"). */
  label: string;
  /** Route path that selects a category. */
  pathFor: (id: string) => string;
  /** Query string kept on the category links (e.g. `?channel=…`, the sort order). */
  search?: string;
}

export function CategoryNav({
  categories,
  selectedId,
  variant,
  label,
  pathFor,
  search = '',
}: CategoryNavProps) {
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
      <Box component="nav" aria-label={label} sx={{ overflowX: 'auto', flexShrink: 0, pb: 1 }}>
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
                  to={{ pathname: pathFor(c.id), search }}
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
      aria-label={label}
      sx={{ height: '100%', overflowY: 'auto', bgcolor: 'tokens.surface1', borderRadius: 3 }}
    >
      <List dense>
        {categories.map((c) => {
          const selected = c.id === selectedId;
          return (
            <li key={c.id}>
              <ListItemButton
                component={Link}
                to={{ pathname: pathFor(c.id), search }}
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
