// Strings por feature em src/i18n/pt-PT/<feature>.ts (ADR-012); agregadas aqui.
import { app } from './pt-PT/app';
import { dbErrors } from './pt-PT/db';

export const t = { app, db: { errors: dbErrors } } as const;
