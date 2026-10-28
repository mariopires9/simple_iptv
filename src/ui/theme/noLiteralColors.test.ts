// @vitest-environment node
// FND-03 AC1: literal colors only live in src/ui/theme; everything else goes through the theme.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..');
const THEME_DIR = join('ui', 'theme') + sep;

/** Hex colors in string literals, and CSS color functions. */
const COLOR_LITERAL = /['"`]#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})['"`]|\b(?:rgba?|hsla?)\(/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('no literal colors outside src/ui/theme', () => {
  it('detects a color literal', () => {
    expect(COLOR_LITERAL.test("color: '#3DDCB0'")).toBe(true);
    expect(COLOR_LITERAL.test('background: rgba(0, 0, 0, .5)')).toBe(true);
    expect(COLOR_LITERAL.test("getElementById('root')")).toBe(false);
  });

  it('has no offenders', () => {
    const offenders = walk(SRC)
      .filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => !relative(SRC, f).startsWith(THEME_DIR))
      .filter((f) => COLOR_LITERAL.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
