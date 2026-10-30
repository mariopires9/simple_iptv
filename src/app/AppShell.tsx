// App shell (FND-03, docs/UX_UI.md §3): top bar + responsive main navigation + content area.
// Must render inside the router (FND-04): the selected destination comes from the location.
//   < 600 px     → bottom bar (Settings in the top bar menu)
//   600–1199 px  → navigation rail
//   ≥ 1200 px    → expanded rail
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { SourceSelectorSlot } from '@/features/sources';
import { pageMargin } from '@/ui/theme/tokens';
import { BottomNav } from './shell/BottomNav';
import { navIdForPath } from './shell/navItems';
import { NavRail } from './shell/NavRail';
import { mainLandmarkProps, SkipLink } from './shell/SkipLink';
import { TopBar } from './shell/TopBar';

export type NavLayout = 'bottom' | 'rail' | 'expanded';

export interface AppShellProps {
  children: ReactNode;
  /** Active list selector slot; defaults to the SRC-08 selector. */
  sourceSelector?: ReactNode;
  /** Search entry point slot (search story). */
  searchAction?: ReactNode;
}

export function useNavLayout(): NavLayout {
  const theme = useTheme();
  const isTablet = useMediaQuery(theme.breakpoints.up('sm'), { noSsr: true });
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'), { noSsr: true });
  if (isDesktop) return 'expanded';
  return isTablet ? 'rail' : 'bottom';
}

const defaultSourceSelector = <SourceSelectorSlot />;

export function AppShell({
  children,
  sourceSelector = defaultSourceSelector,
  searchAction,
}: AppShellProps) {
  const layout = useNavLayout();
  // The current destination follows the route; the nav items are links (FND-04).
  const selected = navIdForPath(useLocation().pathname);
  const isMobile = layout === 'bottom';
  // Settings selected on mobile (it lives in the top bar menu): the "More options" button shows
  // the selected state; the bottom bar then has no current item.

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <SkipLink />
      <TopBar
        showSettings={isMobile}
        settingsSelected={selected === 'settings'}
        sourceSelector={sourceSelector}
        searchAction={searchAction}
      />
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!isMobile && <NavRail expanded={layout === 'expanded'} selected={selected} />}
        <Box
          component="main"
          {...mainLandmarkProps}
          sx={{
            // Focused by the skip link (UX-03): a landmark, not a control, so no focus ring.
            '&:focus': { outline: 'none' },
            flex: 1,
            minWidth: 0,
            // Same breakpoints as the navigation layout (sm = 600, lg = 1200).
            p: {
              xs: `${pageMargin.mobile}px`,
              sm: `${pageMargin.tablet}px`,
              lg: `${pageMargin.desktop}px`,
            },
          }}
        >
          {children}
        </Box>
      </Box>
      {isMobile && <BottomNav selected={selected} />}
    </Box>
  );
}
