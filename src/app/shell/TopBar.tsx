// Top bar: app name, source selector slot, search and the overflow menu (theme; Settings on mobile),
// with the connection banner (PWA-04) underneath.
import CheckRounded from '@mui/icons-material/CheckRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useId, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { SearchAction } from '@/features/search';
import { t } from '@/i18n';
import { ConnectionBanner } from '@/ui/state';
import { THEME_PREFERENCES, useThemeMode } from '@/ui/theme';
import { navSize } from '@/ui/theme/tokens';
import { SETTINGS_NAV_ITEM } from './navItems';

export interface TopBarProps {
  /** Show "Settings" in the overflow menu (mobile, where the bottom bar has no room for it). */
  showSettings: boolean;
  settingsSelected: boolean;
  /** Active list selector — filled in by the sources stories. */
  sourceSelector?: ReactNode;
  /** Search entry point; defaults to the global search button and `/` shortcut (SCH-02). */
  searchAction?: ReactNode;
}

export function TopBar({
  showSettings,
  settingsSelected,
  sourceSelector,
  searchAction = <SearchAction />,
}: TopBarProps) {
  const { preference, setPreference } = useThemeMode();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const buttonId = useId();
  const themeLabelId = useId();
  // On mobile Settings lives in this menu: when it is the current page, the menu button carries
  // the selected state (accent color) so the top bar still shows where the user is.
  const menuHoldsCurrentPage = showSettings && settingsSelected;
  const closeMenu = () => setMenuAnchor(null);

  return (
    <AppBar position="sticky" component="header">
      <Toolbar sx={{ minHeight: { xs: navSize.topBar }, gap: 1 }}>
        <Typography component="span" variant="h3" noWrap sx={{ flexShrink: 0 }}>
          {t.app.name}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
          {sourceSelector}
        </Box>
        {searchAction}
        <IconButton
          id={buttonId}
          aria-label={t.nav.moreOptions}
          aria-haspopup="menu"
          aria-controls={menuAnchor ? menuId : undefined}
          aria-expanded={menuAnchor ? true : undefined}
          onClick={(event) => setMenuAnchor(event.currentTarget)}
          edge="end"
          data-selected={menuHoldsCurrentPage || undefined}
          sx={menuHoldsCurrentPage ? { color: 'primary.main' } : undefined}
        >
          <MoreVertRounded />
        </IconButton>
      </Toolbar>
      {/* PWA-04: inside the sticky header, so it stays visible while the page scrolls. */}
      <ConnectionBanner />
      <Menu
        id={menuId}
        anchorEl={menuAnchor}
        open={menuAnchor !== null}
        onClose={closeMenu}
        slotProps={{ list: { 'aria-labelledby': buttonId } }}
      >
        {showSettings && [
          <MenuItem
            key="settings"
            selected={settingsSelected}
            component={NavLink}
            to={SETTINGS_NAV_ITEM.to}
            onClick={closeMenu}
          >
            <ListItemIcon>{SETTINGS_NAV_ITEM.icon}</ListItemIcon>
            <ListItemText>{SETTINGS_NAV_ITEM.label}</ListItemText>
          </MenuItem>,
          <Divider key="divider" />,
        ]}
        <ListSubheader id={themeLabelId} sx={{ bgcolor: 'transparent', lineHeight: 2.5 }}>
          {t.nav.theme}
        </ListSubheader>
        {/* menu > group > menuitemradio, labelled by the "Theme" subheader. MenuList's roving
            focus registers items through context, so the nesting keeps arrow-key navigation. */}
        <Box component="li" role="none" sx={{ p: 0 }}>
          <Box
            component="ul"
            role="group"
            aria-labelledby={themeLabelId}
            sx={{ listStyle: 'none', m: 0, p: 0 }}
          >
            {THEME_PREFERENCES.map((option) => (
              <MenuItem
                key={option}
                role="menuitemradio"
                aria-checked={preference === option}
                onClick={() => {
                  setPreference(option);
                  closeMenu();
                }}
              >
                <ListItemIcon>{preference === option && <CheckRounded />}</ListItemIcon>
                <ListItemText>{t.nav.themes[option]}</ListItemText>
              </MenuItem>
            ))}
          </Box>
        </Box>
      </Menu>
    </AppBar>
  );
}
