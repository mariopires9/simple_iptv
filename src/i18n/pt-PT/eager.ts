// Initial-bundle namespaces of pt-PT (TEC-01); see src/i18n/en/eager.ts.
import type { enEager } from '../en/eager';
import type { MessageShape } from '../types';
import { app } from './app';
import { db } from './db';
import { nav } from './nav';
import { routes } from './routes';
import { state } from './state';

export const ptPTEager = { app, db, nav, routes, state } satisfies MessageShape<typeof enEager>;
