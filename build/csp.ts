import type { Plugin } from 'vite';

/**
 * Content Security Policy for production builds (SEC-01, docs/SECURITY.md).
 *
 * Notes on the directives:
 * - `style-src 'unsafe-inline'`: Emotion (MUI) injects <style> elements at runtime.
 * - `img-src *`, `media-src *`, `connect-src *`: logos, streams and APIs live on the user's own
 *   servers, which can be any host (http or https), so they cannot be allow-listed.
 * - `worker-src blob:`: hls.js and mpegts.js may start their workers from blob: URLs.
 * - No `'unsafe-eval'` and no external script origins: scripts only come from the app itself.
 * - No `upgrade-insecure-requests`: it would silently rewrite the user's http:// stream and API
 *   URLs to https://, which breaks servers that only speak http instead of surfacing a clear
 *   mixed-content error the UI can explain.
 * - `frame-ancestors` (and `report-uri`/`sandbox`) are ignored when delivered through a <meta>
 *   element. GitHub Pages cannot set response headers, so clickjacking protection via
 *   `frame-ancestors` is not available on that host.
 *
 * The policy is injected only into the build: the dev server relies on inline scripts (the React
 * refresh preamble) that `script-src 'self'` would block.
 */
export const CSP_DIRECTIVES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['default-src', ["'self'"]],
  ['script-src', ["'self'"]],
  ['style-src', ["'self'", "'unsafe-inline'"]],
  ['img-src', ['*', 'data:', 'blob:']],
  ['media-src', ['*', 'blob:']],
  ['connect-src', ['*']],
  ['worker-src', ["'self'", 'blob:']],
  ['font-src', ["'self'", 'data:']],
  ['manifest-src', ["'self'"]],
  ['object-src', ["'none'"]],
  ['base-uri', ["'self'"]],
  ['form-action', ["'none'"]],
];

export const CONTENT_SECURITY_POLICY: string = CSP_DIRECTIVES.map(
  ([name, values]) => `${name} ${values.join(' ')}`,
).join('; ');

/** Vite plugin that prepends the CSP <meta> to index.html, so it precedes every script/style. */
export function cspPlugin(policy: string = CONTENT_SECURITY_POLICY): Plugin {
  return {
    name: 'simple-iptv:csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}
