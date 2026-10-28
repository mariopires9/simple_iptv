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
  /** Route path (hash router, src/app/router.tsx). */
  to: string;
}

/** Shown in every navigation variant (bottom bar, rail, expanded rail). */
export const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', label: t.nav.home, icon: <HomeRounded />, to: '/' },
  { id: 'live', label: t.nav.live, icon: <LiveTvRounded />, to: '/live' },
  { id: 'movies', label: t.nav.movies, icon: <MovieRounded />, to: '/movies' },
  { id: 'series', label: t.nav.series, icon: <TvRounded />, to: '/series' },
  { id: 'favorites', label: t.nav.favorites, icon: <FavoriteRounded />, to: '/favorites' },
];

/** In the rail on tablet/desktop; in the top bar menu on mobile. */
export const SETTINGS_NAV_ITEM: NavItem = {
  id: 'settings',
  label: t.nav.settings,
  icon: <SettingsRounded />,
  to: '/settings',
};

const SECTION_IDS: readonly NavId[] = ['live', 'movies', 'series', 'favorites', 'settings'];

/**
 * The destination a path belongs to, from its first segment (`/movies/category/1` → movies,
 * `/settings/sources` → settings, `/` → home). Paths outside the main navigation (search, an
 * unknown page) → null: no item is current.
 */
export function navIdForPath(pathname: string): NavId | null {
  const first = pathname.split('/').find((segment) => segment !== '');
  if (first === undefined) return 'home';
  return SECTION_IDS.find((id) => id === first) ?? null;
}
