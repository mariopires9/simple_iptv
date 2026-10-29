// Namespaces in the initial bundle (TEC-01): what the shell, the onboarding guard, the state views
// and the route errors render before any feature screen. Feature namespaces load with their
// feature (`ensureMessages`, src/i18n/index.ts).
import { app } from './app';
import { db } from './db';
import { lists } from './lists';
import { nav } from './nav';
import { routes } from './routes';
import { state } from './state';

export const enEager = { app, db, lists, nav, routes, state };
