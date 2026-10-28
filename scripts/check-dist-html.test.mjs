import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, CSP_DIRECTIVES } from '../build/csp.ts';
import { REQUIRED_DIRECTIVES, checkDistHtml, checkPolicy } from './check-dist-html.mjs';

const attr = (s) => s.replaceAll("'", '&#39;');
const meta = (policy = CONTENT_SECURITY_POLICY) =>
  `<meta http-equiv="Content-Security-Policy" content="${attr(policy)}">`;
const page = ({ headStart = meta(), head = '', body = '' } = {}) => `<!doctype html>
<html lang="en">
  <head>
    ${headStart}
    <meta charset="UTF-8" />
    <meta name="referrer" content="no-referrer" />
    <title>Simple IPTV</title>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    ${head}
  </head>
  <body>
    <div id="root"></div>
    ${body}
  </body>
</html>`;

describe('check-dist-html (SEC-01)', () => {
  it('mirrors build/csp.ts exactly', () => {
    expect(Object.entries(REQUIRED_DIRECTIVES)).toEqual(
      CSP_DIRECTIVES.map(([name, values]) => [name, [...values]]),
    );
    expect(checkPolicy(CONTENT_SECURITY_POLICY)).toEqual([]);
  });

  it('accepts the expected built page', () => {
    expect(checkDistHtml(page())).toEqual([]);
  });

  it('accepts the CSP after a comment at the top of <head>', () => {
    expect(checkDistHtml(page({ headStart: `<!-- built -->\n${meta()}` }))).toEqual([]);
  });

  it('accepts single-quoted and unescaped-attribute variants of the meta', () => {
    const m = `<meta content="${attr(CONTENT_SECURITY_POLICY)}" HTTP-EQUIV='content-security-policy' />`;
    expect(checkDistHtml(page({ headStart: m }))).toEqual([]);
  });

  it.each([
    ['missing CSP', page({ headStart: '' }), /CSP <meta> missing/],
    [
      'CSP not first in <head>',
      page({ headStart: `<meta charset="UTF-8" />${meta()}` }),
      /not the first element/,
    ],
    ['duplicated CSP', page({ head: meta() }), /present 2 times/],
    [
      'unsafe-eval',
      page({
        headStart: meta(
          CONTENT_SECURITY_POLICY.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"),
        ),
      }),
      /forbidden 'unsafe-eval'/,
    ],
    [
      'upgrade-insecure-requests',
      page({ headStart: meta(`${CONTENT_SECURITY_POLICY}; upgrade-insecure-requests`) }),
      /forbidden upgrade-insecure-requests/,
    ],
    [
      'missing directive',
      page({ headStart: meta(CONTENT_SECURITY_POLICY.replace("; object-src 'none'", '')) }),
      /missing: object-src/,
    ],
    [
      'weakened directive',
      page({
        headStart: meta(CONTENT_SECURITY_POLICY.replace("script-src 'self'", 'script-src *')),
      }),
      /script-src is "\*"/,
    ],
    [
      'unexpected directive',
      page({ headStart: meta(`${CONTENT_SECURITY_POLICY}; frame-src *`) }),
      /not expected: frame-src/,
    ],
    ['inline script', page({ body: '<script>alert(1)</script>' }), /inline <script>/],
    [
      'inline module script',
      page({ body: '<script type="module">import "/x.js";</script>' }),
      /inline <script>/,
    ],
    [
      'script with src and a body',
      page({ body: '<script src="/a.js">alert(1)</script>' }),
      /inline body/,
    ],
    ['inline handler', page({ body: '<img src="x" onerror="alert(1)">' }), /onerror on <img>/],
    ['inline handler on body', page().replace('<body>', '<body onload="x()">'), /onload on <body>/],
    ['javascript: URL', page({ body: '<a href="javascript:alert(1)">x</a>' }), /javascript: URL/],
  ])('rejects %s', (_label, html, problem) => {
    const problems = checkDistHtml(html);
    expect(problems.some((p) => problem.test(p))).toBe(true);
  });
});
