// @vitest-environment node
// FND-03 AC1: literal colors only live in src/ui/theme; everything else goes through the theme.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..');
const THEME_DIR = join('ui', 'theme') + sep;

/** A hex color (#rgb, #rgba, #rrggbb, #rrggbbaa) or a CSS color function, anywhere in a text. */
const COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])|\b(?:rgba?|hsla?)\(/i;

/**
 * Colors found inside string literals, template literal chunks and JSX text of a TS/TSX source.
 * Parsing (instead of a regex over the file) ignores comments and catches colors embedded in
 * longer strings such as `'1px solid #2E3845'`.
 */
function findColorLiterals(source: string, fileName = 'snippet.tsx'): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const match = COLOR.exec(node.text);
      if (match) found.push(match[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('color literal detector', () => {
  it.each([
    ["const border = '1px solid #2E3845';", '#2E3845'],
    ['const c = "#fff";', '#fff'],
    ["const c = '#3DDCB080';", '#3DDCB080'],
    ['const s = `0 0 0 2px ${x} #0b0e13`;', '#0b0e13'],
    ['const s = `${a} rgba(0, 0, 0, .5)`;', 'rgba('],
    ['const s = `outline: ${w}px solid #abc; ${y}`;', '#abc'],
    ["const s = 'hsl(160 70% 55%)';", 'hsl('],
    ['const el = <p style={{ color: "rgb(1,2,3)" }}>x</p>;', 'rgb('],
  ])('detects %s', (snippet, color) => {
    expect(findColorLiterals(snippet)).toEqual([color]);
  });

  it.each([
    "document.getElementById('root');",
    "const route = '/#/movies/category/123';",
    "const id = '#section-2';",
    '// color: #2E3845 in a comment is not code',
    "const c = theme.palette.tokens.surface2; const k = 'tokens.surface2';",
  ])('ignores %s', (snippet) => {
    expect(findColorLiterals(snippet)).toEqual([]);
  });
});

describe('no literal colors outside src/ui/theme', () => {
  it('has no offenders', () => {
    const offenders = walk(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => !relative(SRC, f).startsWith(THEME_DIR))
      .flatMap((f) =>
        findColorLiterals(readFileSync(f, 'utf8'), f).map((c) => `${relative(SRC, f)}: ${c}`),
      );
    expect(offenders).toEqual([]);
  });
});
