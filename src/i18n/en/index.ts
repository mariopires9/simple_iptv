import { app } from './app';
import { db } from './db';
import { live } from './live';
import { nav } from './nav';
import { onboarding } from './onboarding';
import { player } from './player';
import { routes } from './routes';
import { sources } from './sources';
import { state } from './state';

/** Base (English) messages; aggregated per feature module (ADR-015). */
export const en = { app, db, live, nav, onboarding, player, routes, sources, state };

/** Shape every locale must match exactly. */
export type Messages = typeof en;
