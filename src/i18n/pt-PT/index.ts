import type { Messages } from '../en';
import type { MessageShape } from '../types';
import { app } from './app';
import { db } from './db';
import { live } from './live';
import { nav } from './nav';
import { routes } from './routes';
import { state } from './state';

export const ptPT = { app, db, live, nav, routes, state } satisfies MessageShape<Messages>;
