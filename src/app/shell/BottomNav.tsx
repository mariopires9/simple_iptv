// Mobile (< 600 px) bottom navigation bar.
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Box from '@mui/material/Box';
import { NavLink } from 'react-router';
import { t } from '@/i18n';
import { PRIMARY_NAV_ITEMS, type NavId } from './navItems';

export interface BottomNavProps {
  /** Current destination (from the route); null when no item is current. */
  selected: NavId | null;
}

export function BottomNav({ selected }: BottomNavProps) {
  return (
    <Box
      component="nav"
      aria-label={t.nav.mainNavigation}
      data-layout="bottom"
      sx={{
        // Sticky and in normal flow (last child of the shell column), not `fixed`: the content
        // area never needs a guessed bottom padding, however tall the bar gets (wrapped pt-PT
        // labels, font scaling, iOS home-indicator inset below).
        position: 'sticky',
        bottom: 0,
        zIndex: 'appBar',
        bgcolor: 'tokens.surface2',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Plain list instead of MUI <BottomNavigation>: it clones its direct children, which
          would have to be the actions and not the <li> semantics we want here. */}
      <Box component="ul" sx={{ display: 'flex', m: 0, p: 0, listStyle: 'none' }}>
        {PRIMARY_NAV_ITEMS.map((item) => {
          const isSelected = item.id === selected;
          return (
            <Box component="li" key={item.id} sx={{ display: 'flex', flex: 1, minWidth: 0 }}>
              <BottomNavigationAction
                label={item.label}
                icon={item.icon}
                selected={isSelected}
                showLabel
                component={NavLink}
                to={item.to}
                end={item.to === '/'}
                sx={{ flex: 1, maxWidth: 'none' }}
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
