// Tablet (600–1199 px) navigation rail and desktop (≥ 1200 px) expanded rail.
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { t } from '@/i18n';
import { navSize, radii } from '@/ui/theme/tokens';
import { PRIMARY_NAV_ITEMS, SETTINGS_NAV_ITEM, type NavId, type NavItem } from './navItems';

export interface NavRailProps {
  expanded: boolean;
  selected: NavId;
  onNavigate: (id: NavId) => void;
}

function RailButton({
  item,
  expanded,
  selected,
  onNavigate,
}: {
  item: NavItem;
  expanded: boolean;
  selected: boolean;
  onNavigate: (id: NavId) => void;
}) {
  return (
    <ButtonBase
      onClick={() => onNavigate(item.id)}
      aria-current={selected ? 'page' : undefined}
      sx={{
        width: '100%',
        minHeight: expanded ? 48 : 64, // both ≥ the 44 px touch target
        display: 'flex',
        flexDirection: expanded ? 'row' : 'column',
        justifyContent: expanded ? 'flex-start' : 'center',
        gap: expanded ? 1.5 : 0.5,
        px: expanded ? 2 : 0.5,
        py: 0.5,
        borderRadius: expanded ? `${radii.pill}px` : `${radii.md}px`,
        color: selected ? 'primary.main' : 'text.secondary',
        bgcolor: expanded && selected ? 'tokens.surface3' : 'transparent',
        transition: (theme) => theme.transitions.create(['background-color', 'color']),
        '&:hover': {
          bgcolor: 'tokens.surface3',
          color: selected ? 'primary.main' : 'text.primary',
        },
      }}
    >
      <Box
        aria-hidden
        sx={{
          display: 'grid',
          placeItems: 'center',
          width: expanded ? 'auto' : 56,
          height: 32,
          borderRadius: `${radii.pill}px`,
          bgcolor: !expanded && selected ? 'tokens.surface3' : 'transparent',
        }}
      >
        {item.icon}
      </Box>
      <Typography
        component="span"
        variant={expanded ? 'body2' : 'caption'}
        sx={{
          fontWeight: selected ? 600 : undefined,
          textAlign: expanded ? 'start' : 'center',
          // Longer pt-PT labels wrap instead of being clipped (UX_UI §2.2).
          overflowWrap: 'anywhere',
        }}
      >
        {item.label}
      </Typography>
    </ButtonBase>
  );
}

export function NavRail({ expanded, selected, onNavigate }: NavRailProps) {
  const renderItem = (item: NavItem) => (
    <Box component="li" key={item.id}>
      <RailButton
        item={item}
        expanded={expanded}
        selected={item.id === selected}
        onNavigate={onNavigate}
      />
    </Box>
  );
  const listSx = { listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0.5 } as const;

  return (
    <Box
      component="nav"
      aria-label={t.nav.mainNavigation}
      data-layout={expanded ? 'expanded' : 'rail'}
      sx={{
        position: 'sticky',
        // Sits below the full-width top bar.
        top: navSize.topBar,
        flexShrink: 0,
        alignSelf: 'flex-start',
        width: expanded ? navSize.expandedRail : navSize.rail,
        height: `calc(100dvh - ${navSize.topBar}px)`,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        px: expanded ? 1.5 : 1,
        py: 1,
        bgcolor: 'tokens.surface2',
      }}
    >
      <Box component="ul" sx={listSx}>
        {PRIMARY_NAV_ITEMS.map(renderItem)}
      </Box>
      <Box component="ul" sx={{ ...listSx, mt: 'auto' }}>
        {renderItem(SETTINGS_NAV_ITEM)}
      </Box>
    </Box>
  );
}
