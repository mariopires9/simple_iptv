import type { Messages } from '../en';
import type { MessageShape } from '../types';
import { app } from './app';
import { db } from './db';
import { lists } from './lists';
import { live } from './live';
import { movies } from './movies';
import { nav } from './nav';
import { onboarding } from './onboarding';
import { player } from './player';
import { routes } from './routes';
import { sources } from './sources';
import { state } from './state';

export const ptPT = {
  app,
  db,
  lists,
  live,
  movies,
  nav,
  onboarding,
  player,
  routes,
  sources,
  state,
} satisfies MessageShape<Messages>;
