// Checks the built dist/index.html against the SEC-01 policy (docs/SECURITY.md): the CSP <meta>
// is present, first in <head> and complete; every script is external; no inline event handlers.
// Usage: node scripts/check-dist-html.mjs [path/to/index.html]   (default: dist/index.html)
// No dependencies on purpose: it runs in CI right after `vite build`.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Required directives and their exact sources. Mirrors CSP_DIRECTIVES in build/csp.ts (a .mjs
 * script cannot import TypeScript); scripts/check-dist-html.test.mjs asserts both stay in sync.
 */
export const REQUIRED_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ['*', 'data:', 'blob:'],
  'media-src': ['*', 'blob:'],
  'connect-src': ['*'],
  'worker-src': ["'self'", 'blob:'],
  'font-src': ["'self'", 'data:'],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'none'"],
};

/** Tokens that must never appear anywhere in the policy. */
export const FORBIDDEN_TOKENS = [
  "'unsafe-eval'",
  "'wasm-unsafe-eval'",
  "'unsafe-hashes'",
  'upgrade-insecure-requests',
];

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return String.fromCodePoint(n);
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const ATTRIBUTE = /([^\s"'=<>/`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Attributes of a start tag's inner text (`meta a="1" b`), names lower-cased, values decoded. */
function parseAttributes(text) {
  const attrs = new Map();
  for (const m of text.matchAll(ATTRIBUTE)) {
    const name = m[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

function startTags(html) {
  return [...html.matchAll(START_TAG)].map((m) => ({
    name: m[1].toLowerCase(),
    attrs: parseAttributes(m[2]),
    index: m.index,
    end: m.index + m[0].length,
  }));
}

function isCspMeta(tag) {
  return (
    tag.name === 'meta' &&
    (tag.attrs.get('http-equiv') ?? '').toLowerCase() === 'content-security-policy'
  );
}

/** Problems found in the policy text (empty array when it satisfies SEC-01). */
export function checkPolicy(policy) {
  const problems = [];
  const directives = new Map();
  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/).filter(Boolean);
    if (name === undefined) continue;
    const key = name.toLowerCase();
    if (directives.has(key)) problems.push(`CSP directive repeated: ${key}`);
    else directives.set(key, values);
  }
  for (const token of FORBIDDEN_TOKENS) {
    if (policy.toLowerCase().includes(token)) problems.push(`CSP contains forbidden ${token}`);
  }
  for (const [name, expected] of Object.entries(REQUIRED_DIRECTIVES)) {
    const actual = directives.get(name);
    if (actual === undefined) problems.push(`CSP directive missing: ${name}`);
    else if (actual.join(' ') !== expected.join(' ')) {
      problems.push(`CSP ${name} is "${actual.join(' ')}", expected "${expected.join(' ')}"`);
    }
  }
  for (const name of directives.keys()) {
    if (!(name in REQUIRED_DIRECTIVES)) problems.push(`CSP directive not expected: ${name}`);
  }
  return problems;
}

/** Problems found in a built index.html (empty array when it satisfies SEC-01). */
export function checkDistHtml(html) {
  const problems = [];
  const tags = startTags(html);

  const cspMetas = tags.filter(isCspMeta);
  if (cspMetas.length === 0) problems.push('CSP <meta> missing');
  if (cspMetas.length > 1) problems.push(`CSP <meta> present ${cspMetas.length} times`);

  const head = tags.find((t) => t.name === 'head');
  if (head === undefined) {
    problems.push('<head> missing');
  } else {
    const first = tags.find((t) => t.index >= head.end);
    const between = first === undefined ? '' : html.slice(head.end, first.index);
    const onlyWhitespaceOrComments = between.replace(/<!--[\s\S]*?-->/g, '').trim() === '';
    if (first === undefined || !isCspMeta(first) || !onlyWhitespaceOrComments) {
      problems.push('CSP <meta> is not the first element in <head>');
    }
  }
  if (cspMetas.length === 1) {
    problems.push(...checkPolicy(cspMetas[0].attrs.get('content') ?? ''));
  }

  for (const m of html.matchAll(
    /<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    const attrs = parseAttributes(m[1]);
    if (!attrs.get('src')) problems.push('inline <script> (no src)');
    if (m[2].trim() !== '') problems.push('<script> with an inline body');
  }

  for (const tag of tags) {
    for (const [name, value] of tag.attrs) {
      if (/^on/.test(name)) problems.push(`inline event handler ${name} on <${tag.name}>`);
      if (/^\s*javascript:/i.test(value))
        problems.push(`javascript: URL in ${name} on <${tag.name}>`);
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2] ?? 'dist/index.html';
  const problems = checkDistHtml(readFileSync(file, 'utf8'));
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`${file}: ${p}\n`);
    process.exit(1);
  }
  process.stdout.write(`${file}: CSP and script checks ok.\n`);
}
