import { app } from './app';
import { db } from './db';
import { diagnostics } from './diagnostics';
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

/**
 * Base (English) messages, every namespace (ADR-015). Defines the `Messages` type; at runtime only
 * tests and tooling import this aggregate (TEC-01: the app loads feature namespaces lazily).
 */
export const en = {
  app,
  db,
  diagnostics,
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
};

/** Shape every locale must match exactly. */
export type Messages = typeof en;
