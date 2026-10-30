import type { Plugin } from 'vite';

/**
 * QA-04: the entry stylesheet (the self-hosted Inter `@font-face` rules, ~2 kB) is inlined into
 * index.html as a `<style>` element instead of a render-blocking `<link>`: one request less before
 * the first paint on a slow mobile connection. Its `url()`s are already absolute (base path
 * included), so they resolve the same from the page. The CSP allows inline styles (`style-src
 * 'unsafe-inline'`, needed by Emotion: build/csp.ts).
 *
 * The file itself stays in the build: lazy chunks list it among their preload dependencies
 * (Vite's preload helper), and a missing file fails those imports (`Unable to preload CSS`), which
 * the chunk-reload handler answers with a page reload. Loaded again later, it only repeats the
 * same `@font-face` rules.
 *
 * `inlineStylesheets` is the pure transform (tested in src/test/inlineCss.test.ts): `readCss` gives
 * the CSS of an emitted file name.
 */
export function inlineStylesheets(
  html: string,
  readCss: (fileName: string) => string | undefined,
): string {
  return html.replace(
    /<link rel="stylesheet"(?: crossorigin)? href="[^"]*?\/?(assets\/[^"/]+\.css)">/g,
    (tag, fileName: string) => {
      const css = readCss(fileName);
      // `</style` inside the CSS would end the element early: keep the link then.
      if (css === undefined || /<\/style/i.test(css)) return tag;
      return `<style>${css}</style>`;
    },
  );
}

export function inlineCssPlugin(): Plugin {
  return {
    name: 'simple-iptv:inline-css',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, { bundle }) {
        if (!bundle) return html;
        return inlineStylesheets(html, (fileName) => {
          const file = bundle[fileName];
          if (file?.type !== 'asset') return undefined;
          const { source } = file;
          return typeof source === 'string' ? source : new TextDecoder().decode(source);
        });
      },
    },
  };
}
