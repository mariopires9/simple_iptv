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

/** Keys of `t.nav` that name a destination. */
export type NavLabelKey = NavId;

export interface NavItem {
  id: NavId;
  /** Key of the label in `t.nav`; the module holds keys only, never text. */
  labelKey: NavLabelKey;
  /**
   * The label in the active locale, read from `t` on every access (a getter): the items are
   * module constants, so a value captured at module load would keep the language the app
   * started in (QA-02 defect, UX-06).
   */
  readonly label: string;
  icon: ReactNode;
  /** Route path (hash router, src/app/router.tsx). */
  to: string;
}

function navItem(id: NavId, icon: ReactNode, to: string): NavItem {
  return {
    id,
    labelKey: id,
    get label() {
      return t.nav[id];
    },
    icon,
    to,
  };
}

/** Shown in every navigation variant (bottom bar, rail, expanded rail). */
export const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  navItem('home', <HomeRounded />, '/'),
  navItem('live', <LiveTvRounded />, '/live'),
  navItem('movies', <MovieRounded />, '/movies'),
  navItem('series', <TvRounded />, '/series'),
  navItem('favorites', <FavoriteRounded />, '/favorites'),
];

/** In the rail on tablet/desktop; in the top bar menu on mobile. */
export const SETTINGS_NAV_ITEM: NavItem = navItem('settings', <SettingsRounded />, '/settings');

const SECTION_IDS: readonly NavId[] = ['live', 'movies', 'series', 'favorites', 'settings'];

/**
 * The destination a path belongs to, from its first segment (`/movies/category/1` → movies,
 * `/settings/sources` → settings, `/` → home). Paths outside the main navigation (search, an
 * unknown page) → null: no item is current.
 */
export function navIdForPath(pathname: string): NavId | null {
  // Lower-cased: React Router matches paths case-insensitively (`/Movies` renders Movies).
  const first = pathname
    .toLowerCase()
    .split('/')
    .find((segment) => segment !== '');
  if (first === undefined) return 'home';
  return SECTION_IDS.find((id) => id === first) ?? null;
}
