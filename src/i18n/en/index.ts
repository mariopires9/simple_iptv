import { app } from './app';
import { db } from './db';
import { nav } from './nav';
import { routes } from './routes';

/** Base (English) messages; aggregated per feature module (ADR-015). */
export const en = { app, db, nav, routes };

/** Shape every locale must match exactly. */
export type Messages = typeof en;
