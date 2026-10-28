import type { Messages } from '../en';
import type { MessageShape } from '../types';
import { app } from './app';
import { db } from './db';
import { nav } from './nav';
import { player } from './player';
import { routes } from './routes';
import { state } from './state';

export const ptPT = { app, db, nav, player, routes, state } satisfies MessageShape<Messages>;
