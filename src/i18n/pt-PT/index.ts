import type { Messages } from '../en';
import type { MessageShape } from '../types';
import { app } from './app';
import { db } from './db';
import { nav } from './nav';
import { routes } from './routes';

export const ptPT = { app, db, nav, routes } satisfies MessageShape<Messages>;
