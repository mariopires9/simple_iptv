import { describe, expect, it } from 'vitest';
import { inlineStylesheets } from '../../build/inlineCss.ts';

const CSS = '@font-face{font-family:Inter Variable;src:url(/repo/assets/inter-latin.woff2)}';

describe('inlineStylesheets (QA-04)', () => {
  it('replaces the entry stylesheet link by its CSS, under any base path', () => {
    const inlined: string[] = [];
    const html = inlineStylesheets(
      '<head><link rel="stylesheet" crossorigin href="/repo/assets/index-abc.css"></head>',
      (file) => (file === 'assets/index-abc.css' ? CSS : undefined),
      (file) => inlined.push(file),
    );
    expect(html).toBe(`<head><style>${CSS}</style></head>`);
    expect(inlined).toEqual(['assets/index-abc.css']);
  });

  it('keeps the link when the file is unknown or its CSS could close the style element', () => {
    const link = '<link rel="stylesheet" crossorigin href="/assets/index-abc.css">';
    expect(inlineStylesheets(link, () => undefined)).toBe(link);
    expect(inlineStylesheets(link, () => 'a{}</style><script>')).toBe(link);
  });
});
