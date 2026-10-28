import { app } from './app';
import { db } from './db';
import { nav } from './nav';
import { player } from './player';
import { routes } from './routes';
import { state } from './state';

/** Base (English) messages; aggregated per feature module (ADR-015). */
export const en = { app, db, nav, player, routes, state };

/** Shape every locale must match exactly. */
export type Messages = typeof en;
