// ADR-003 budget guard: Dexie (`@/core/db`) must not ride in the initial chunk. The modules that
// are statically reachable from the entry may only import it dynamically (`import('@/core/db')`)
// or as types.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAZY_NAMESPACES } from '@/i18n';

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
  // features/sources modules the shell and router import statically (SRC-08 selector slot).
  ...[
    'index.ts',
    'routes.tsx',
    'sourcesPresence.ts',
    'activeSource.ts',
    'SourceSelectorSlot.tsx',
  ].map((file) => join(SRC, 'features', 'sources', file)),
  // The session store loads Dexie lazily too (any screen may import it).
  ...sourceFiles(join(SRC, 'core', 'session')),
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

// TEC-01: feature strings load with their feature. Walks the real static import graph from the
// entry (non-type `import`/`export … from`, resolved like Vite: `@/` alias, relative paths,
// `index` files) and checks that no feature string module — nor an aggregate catalog that imports
// them all — is reachable without a dynamic `import()`.

/** Static, non-type module specifiers of a source file (`import type`/`export type` excluded). */
function staticImports(source: string): string[] {
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/gm;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? '');
}

function resolveModule(from: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = join(dirname(from), specifier);
  else return undefined; // a package
  return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
}

function staticClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of staticImports(readFileSync(file, 'utf8'))) {
      const resolved = resolveModule(file, specifier);
      if (resolved && /\.tsx?$/.test(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

describe('initial bundle — feature strings (TEC-01)', () => {
  const closure = [...staticClosure(join(SRC, 'main.tsx'))].map((file) => relative(SRC, file));

  it('walks the real graph (shell, router, selector slot, i18n registry, eager strings)', () => {
    expect(closure).toEqual(
      expect.arrayContaining([
        'app/AppShell.tsx',
        'app/router.tsx',
        'features/sources/SourceSelectorSlot.tsx',
        'ui/lazyScreen.ts',
        'i18n/index.ts',
        'i18n/registry.ts',
        'i18n/en/eager.ts',
        'i18n/en/routes.ts',
        'i18n/pt-PT/state.ts',
      ]),
    );
  });

  it('no feature string module or full catalog is statically reachable from the entry', () => {
    const lazyStrings = LAZY_NAMESPACES.flatMap((ns) => [
      `i18n/en/${ns}.ts`,
      `i18n/pt-PT/${ns}.ts`,
    ]);
    const forbidden = new Set([
      ...lazyStrings,
      'i18n/en/index.ts',
      'i18n/pt-PT/index.ts',
      'i18n/catalogs.ts',
    ]);
    expect(lazyStrings.length).toBeGreaterThan(0);
    expect(closure.filter((file) => forbidden.has(file))).toEqual([]);
  });

  it('the parser sees static imports and skips type-only and dynamic ones', () => {
    const source = [
      "import { live } from '@/i18n/en/live';",
      "import {\n  a,\n  b,\n} from './multi';",
      "export { x } from '../reexport';",
      "export * from './star';",
      "import './side-effect';",
      "import type { Messages } from '@/i18n/en';",
      "export type { Locale } from './types';",
      "const lazy = () => import('./en/movies');",
      "export const value = 'not/a/module';",
    ].join('\n');
    expect(staticImports(source)).toEqual([
      '@/i18n/en/live',
      './multi',
      '../reexport',
      './star',
      './side-effect',
    ]);
  });
});
