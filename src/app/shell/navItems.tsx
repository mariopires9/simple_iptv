// Main navigation destinations (docs/UX_UI.md §3).
import FavoriteRounded from '@mui/icons-material/FavoriteRounded';
import HomeRounded from '@mui/icons-material/HomeRounded';
import LiveTvRounded from '@mui/icons-material/LiveTvRounded';
import MovieRounded from '@mui/icons-material/MovieRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import TvRounded from '@mui/icons-material/TvRounded';
import type { ReactNode } from 'react';
import { t } from '@/i18n';

export type NavId = 'home' | 'live' | 'movies' | 'series' | 'favorites' | 'settings';

export interface NavItem {
  id: NavId;
  label: string;
  icon: ReactNode;
}

/** Shown in every navigation variant (bottom bar, rail, expanded rail). */
export const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', label: t.nav.home, icon: <HomeRounded /> },
  { id: 'live', label: t.nav.live, icon: <LiveTvRounded /> },
  { id: 'movies', label: t.nav.movies, icon: <MovieRounded /> },
  { id: 'series', label: t.nav.series, icon: <TvRounded /> },
  { id: 'favorites', label: t.nav.favorites, icon: <FavoriteRounded /> },
];

/** In the rail on tablet/desktop; in the top bar menu on mobile. */
export const SETTINGS_NAV_ITEM: NavItem = {
  id: 'settings',
  label: t.nav.settings,
  icon: <SettingsRounded />,
};
