import { app } from './app';
import { db } from './db';
import { live } from './live';
import { movies } from './movies';
import { nav } from './nav';
import { onboarding } from './onboarding';
import { player } from './player';
import { routes } from './routes';
import { sources } from './sources';
import { state } from './state';

/**
 * Base (English) messages, every namespace (ADR-015). Defines the `Messages` type; at runtime only
 * tests and tooling import this aggregate (TEC-01: the app loads feature namespaces lazily).
 */
export const en = { app, db, live, movies, nav, onboarding, player, routes, sources, state };

/** Shape every locale must match exactly. */
export type Messages = typeof en;
