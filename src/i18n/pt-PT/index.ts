import type { Messages } from '../en';
import type { MessageShape } from '../types';
import { app } from './app';
import { db } from './db';

export const ptPT = { app, db } satisfies MessageShape<Messages>;
