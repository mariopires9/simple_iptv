// ADR-003 budget guard: Dexie (`@/core/db`) must not ride in the initial chunk. The modules that
// are statically reachable from the entry may only import it dynamically (`import('@/core/db')`)
// or as types.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

// Entry graph before the lazy screens: main → app (shell, router, layouts) → ui/theme, i18n.
const INITIAL = [
  join(SRC, 'main.tsx'),
  ...sourceFiles(join(SRC, 'app')),
  ...sourceFiles(join(SRC, 'ui')),
  ...sourceFiles(join(SRC, 'i18n')),
];

/** Static, non-type imports of the core/db barrel (or any of its modules). */
const STATIC_DB_IMPORT = /^\s*import\s+(?!type\b)[^;]*?from\s+['"]@\/core\/db(?:\/[^'"]*)?['"]/m;

// Built at runtime so this file does not itself look like a core/db import to other guards.
const DB = ['@', 'core', 'db'].join('/');

describe('initial bundle', () => {
  it('no statically reachable module imports @/core/db (Dexie) eagerly', () => {
    const offenders = INITIAL.filter((file) =>
      STATIC_DB_IMPORT.test(readFileSync(file, 'utf8')),
    ).map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('the guard catches an eager import', () => {
    expect(STATIC_DB_IMPORT.test(`import { settingsRepo } from '${DB}';`)).toBe(true);
    expect(STATIC_DB_IMPORT.test(`import { x } from '${DB}/database';`)).toBe(true);
    expect(STATIC_DB_IMPORT.test(`import { THEMES } from '${DB}/types';`)).toBe(true);
    expect(STATIC_DB_IMPORT.test(`import type { Theme } from '${DB}';`)).toBe(false);
    expect(STATIC_DB_IMPORT.test(`const db = await import('${DB}');`)).toBe(false);
  });
});
