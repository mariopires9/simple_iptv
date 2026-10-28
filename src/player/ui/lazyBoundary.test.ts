// @vitest-environment node
// PLY-02: the player UI must stay out of the initial bundle. `@/player` (types, controller) never
// re-exports it, and no module outside src/player/ui imports it statically — features load it
// with `import('@/player/ui')`.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..');
const UI_DIR = join(SRC, 'player', 'ui');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

/** Static (non-type) import/export of the player UI, by alias or by a relative `./ui` path. */
const STATIC_UI_IMPORT =
  /^\s*(?:import|export)\s+(?!type\b)(?:[^;'"]*?\bfrom\s+)?['"](?:@\/player\/ui|\.\/ui)(?:\/[^'"]*)?['"]/m;

describe('player UI lazy boundary', () => {
  it('no module outside src/player/ui imports the player UI statically', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !file.startsWith(UI_DIR))
      .filter((file) => STATIC_UI_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('the guard catches static imports and allows type-only and dynamic ones', () => {
    expect(STATIC_UI_IMPORT.test(`import { PlayerView } from '@/player/ui';`)).toBe(true);
    expect(STATIC_UI_IMPORT.test(`export * from './ui';`)).toBe(true);
    expect(STATIC_UI_IMPORT.test(`import type { PlayerViewProps } from '@/player/ui';`)).toBe(
      false,
    );
    expect(STATIC_UI_IMPORT.test(`const m = await import('@/player/ui');`)).toBe(false);
  });
});
