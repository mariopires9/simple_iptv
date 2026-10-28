// App shell (FND-03, docs/UX_UI.md §3): top bar + responsive main navigation + content area.
//   < 600 px     → bottom bar (Settings in the top bar menu)
//   600–1199 px  → navigation rail
//   ≥ 1200 px    → expanded rail
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useState, type ReactNode } from 'react';
import { navSize, pageMargin } from '@/ui/theme/tokens';
import { BottomNav } from './shell/BottomNav';
import type { NavId } from './shell/navItems';
import { NavRail } from './shell/NavRail';
import { TopBar } from './shell/TopBar';

export type NavLayout = 'bottom' | 'rail' | 'expanded';

export interface AppShellProps {
  children: ReactNode;
  /** Active list selector slot (sources stories). */
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

export function AppShell({ children, sourceSelector, searchAction }: AppShellProps) {
  const layout = useNavLayout();
  // TODO(FND-04): the selected destination comes from the router (current route) and the nav
  // items become links; until then it is local state only.
  const [selected, setSelected] = useState<NavId>('home');
  const isMobile = layout === 'bottom';

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        showSettings={isMobile}
        settingsSelected={selected === 'settings'}
        onNavigate={setSelected}
        sourceSelector={sourceSelector}
        searchAction={searchAction}
      />
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!isMobile && (
          <NavRail expanded={layout === 'expanded'} selected={selected} onNavigate={setSelected} />
        )}
        <Box
          component="main"
          sx={{
            flex: 1,
            minWidth: 0,
            p: `${
              layout === 'bottom'
                ? pageMargin.mobile
                : layout === 'rail'
                  ? pageMargin.tablet
                  : pageMargin.desktop
            }px`,
            // Keep content clear of the fixed bottom bar.
            pb: isMobile
              ? `calc(${navSize.bottomNav + pageMargin.mobile}px + env(safe-area-inset-bottom))`
              : undefined,
          }}
        >
          {children}
        </Box>
      </Box>
      {isMobile && <BottomNav selected={selected} onNavigate={setSelected} />}
    </Box>
  );
}
