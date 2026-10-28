import { app } from './app';
import { db } from './db';

/** Base (English) messages; aggregated per feature module (ADR-015). */
export const en = { app, db };

/** Shape every locale must match exactly. */
export type Messages = typeof en;
