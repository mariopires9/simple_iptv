// Mobile (< 600 px) bottom navigation bar.
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Box from '@mui/material/Box';
import { t } from '@/i18n';
import { PRIMARY_NAV_ITEMS, type NavId } from './navItems';

export interface BottomNavProps {
  selected: NavId;
  onNavigate: (id: NavId) => void;
}

export function BottomNav({ selected, onNavigate }: BottomNavProps) {
  return (
    <Box
      component="nav"
      aria-label={t.nav.mainNavigation}
      data-layout="bottom"
      sx={{
        position: 'fixed',
        insetInline: 0,
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
                onClick={() => onNavigate(item.id)}
                aria-current={isSelected ? 'page' : undefined}
                sx={{ flex: 1, maxWidth: 'none' }}
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
