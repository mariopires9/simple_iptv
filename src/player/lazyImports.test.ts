// ADR-005 / PLY-01 AC2 budget guard: hls.js (~120 KB gz) and mpegts.js (~60 KB gz) are only
// downloaded on first use. No source module may import them statically (an `import type` is
// erased; `import { type X }` is not, under verbatimModuleSyntax); the engines load them with
// `import()` inside load().
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

// Built at runtime so this file does not itself look like an import of the libraries.
const LIBS = ['hls', 'mpegts'].map((name) => `${name}\\.js`).join('|');

/** Static, non-type `import … from`, side-effect `import '…'` or `export … from` of either library. */
const STATIC_LIB_IMPORT = new RegExp(
  String.raw`^\s*(?:import|export)\s+(?!type\b)(?:[^;'"]*?\bfrom\s+)?['"](?:${LIBS})(?:/[^'"]*)?['"]`,
  'm',
);

const lib = (name: 'hls' | 'mpegts', sub = '') => `${name}.js${sub}`;

describe('lazy media libraries', () => {
  it('no source module imports hls.js or mpegts.js statically', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => STATIC_LIB_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('only the engine files load the libraries, with a dynamic import()', () => {
    const loaders = sourceFiles(SRC)
      .filter((file) =>
        /import\(\s*['"](?:hls|mpegts)\.js['"]\s*\)/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(SRC, file).replaceAll('\\', '/'))
      .sort();
    expect(loaders).toEqual(['player/engines/hls.ts', 'player/engines/mpegts.ts']);
  });

  it('the guard catches eager imports and allows type-only and dynamic ones', () => {
    const q = (s: string) => `'${s}'`;
    expect(STATIC_LIB_IMPORT.test(`import Hls from ${q(lib('hls'))};`)).toBe(true);
    expect(STATIC_LIB_IMPORT.test(`import Hls, { Events } from ${q(lib('hls'))};`)).toBe(true);
    expect(STATIC_LIB_IMPORT.test(`import { type ErrorData } from ${q(lib('hls'))};`)).toBe(true);
    expect(STATIC_LIB_IMPORT.test(`import ${q(lib('hls', '/light'))};`)).toBe(true);
    expect(STATIC_LIB_IMPORT.test(`import * as m from "${lib('mpegts')}";`)).toBe(true);
    expect(STATIC_LIB_IMPORT.test(`export { default } from ${q(lib('mpegts'))};`)).toBe(true);
    expect(STATIC_LIB_IMPORT.test(`import {\n  Events,\n} from ${q(lib('hls'))};`)).toBe(true);
    expect(STATIC_LIB_IMPORT.test(`import type Hls from ${q(lib('hls'))};`)).toBe(false);
    expect(STATIC_LIB_IMPORT.test(`import type { ErrorData } from ${q(lib('hls'))};`)).toBe(false);
    expect(STATIC_LIB_IMPORT.test(`const m = await import(${q(lib('mpegts'))});`)).toBe(false);
    expect(STATIC_LIB_IMPORT.test(`import x from 'hls.json';`)).toBe(false);
  });
});
