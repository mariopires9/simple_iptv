import type { Messages } from '../en';
import type { MessageShape } from '../types';
import { app } from './app';
import { db } from './db';
import { favorites } from './favorites';
import { install } from './install';
import { lists } from './lists';
import { live } from './live';
import { movies } from './movies';
import { nav } from './nav';
import { onboarding } from './onboarding';
import { player } from './player';
import { routes } from './routes';
import { search } from './search';
import { series } from './series';
import { settings } from './settings';
import { sources } from './sources';
import { state } from './state';

export const ptPT = {
  app,
  db,
  favorites,
  install,
  lists,
  live,
  movies,
  nav,
  onboarding,
  player,
  routes,
  search,
  series,
  settings,
  sources,
  state,
} satisfies MessageShape<Messages>;
