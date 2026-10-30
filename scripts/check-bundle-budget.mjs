// Checks the production build against the QA-03 AC2 bundle budgets (ADR-003, ADR-017):
// - initial JS ≤ 200 kB gz: the entry script(s) of dist/index.html, its modulepreload links and
//   every chunk they statically import (transitively) — what the browser loads before first render;
// - hls.js chunk ≤ 190 kB gz and mpegts.js chunk ≤ 80 kB gz, both present and outside that initial
//   set (loaded with import() on first play only, PLY-01 AC2).
// Sizes are gzip level 9 of each file, in kB of 1000 bytes (the unit Vite's build report uses).
// Prints a table and writes dist-report/bundle-budget.json (uploaded as a CI artifact).
// Usage: node scripts/check-bundle-budget.mjs [distDir] [base] [reportFile]
//   (defaults: dist, $VITE_BASE or "/", dist-report/bundle-budget.json)
// No dependencies on purpose: it runs right after `vite build` (npm run budget). The base path and
// engine chunk globs come from build/pwa.ts (Node ≥ 22.18 strips the TypeScript types on import).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { ENGINE_CHUNK_GLOBS, normaliseBase } from '../build/pwa.ts';

const KB = 1000;

/** QA-03 AC2 budgets, in gzip bytes. */
export const BUDGETS = { initial: 200 * KB, hls: 190 * KB, mpegts: 80 * KB };

/** Engine name → dist-relative path pattern (from ENGINE_CHUNK_GLOBS: `assets/hls-*.js`, …). */
const ENGINES = Object.fromEntries(
  ENGINE_CHUNK_GLOBS.map((glob) => [
    posix.basename(glob).split('-')[0],
    new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')}$`),
  ]),
);

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];

/** Dist-relative paths of the scripts index.html loads up front (entry modules + modulepreload). */
export function initialScriptsOfHtml(html, base = '/') {
  const toDist = (url) => (url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, ''));
  const paths = [];
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = attr(tag, 'src');
    if (src && attr(tag, 'type') === 'module') paths.push(toDist(src));
  }
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = attr(tag, 'href');
    if (href && attr(tag, 'rel') === 'modulepreload') paths.push(toDist(href));
  }
  return paths;
}

/**
 * Specifiers of the static `import … from "x"`, `import "x"` and `export … from "x"` statements of
 * a minified ES module. Dynamic `import("x")` (lazy chunks) is not matched.
 */
export function staticImports(code) {
  const pattern = /(?<![\w$.])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?(["'`])([^"'`]+)\1/g;
  return [...code.matchAll(pattern)].map((m) => m[2]);
}

/** The initial chunk set: the HTML's scripts plus everything they statically import. */
export function initialChunks(html, read, base = '/') {
  const seen = new Set();
  const queue = initialScriptsOfHtml(html, base);
  while (queue.length > 0) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    for (const spec of staticImports(read(path))) {
      if (spec.startsWith('.')) queue.push(posix.normalize(posix.join(posix.dirname(path), spec)));
    }
  }
  return [...seen];
}

const gzipBytes = (buffer) => gzipSync(buffer, { level: 9 }).length;

/**
 * Measures a build and checks it against the budgets.
 * `files` lists every dist-relative path; `read(path)` returns its contents (Buffer or string).
 */
export function checkBundleBudget({ html, files, read, base = '/', budgets = BUDGETS }) {
  const missing = initialScriptsOfHtml(html, base).filter((path) => !files.includes(path));
  if (missing.length > 0) {
    return {
      entries: [],
      problems: missing.map((p) => `${p} (from index.html) not in dist: wrong base "${base}"?`),
    };
  }
  const problems = [];
  const initial = initialChunks(html, (path) => read(path).toString(), base);
  const initialGzip = initial.reduce((sum, path) => sum + gzipBytes(read(path)), 0);
  const entries = [
    { name: 'initial JS', files: initial, gzip: initialGzip, budget: budgets.initial },
  ];
  if (initialGzip > budgets.initial) {
    problems.push(`initial JS is ${kb(initialGzip)} gz, over the ${kb(budgets.initial)} budget`);
  }
  for (const [engine, pattern] of Object.entries(ENGINES)) {
    const chunks = files.filter((path) => pattern.test(path));
    const gzip = chunks.reduce((sum, path) => sum + gzipBytes(read(path)), 0);
    entries.push({ name: engine, files: chunks, gzip, budget: budgets[engine] });
    if (chunks.length === 0) problems.push(`no ${engine} chunk found (${pattern})`);
    if (gzip > budgets[engine]) {
      problems.push(`${engine} chunk is ${kb(gzip)} gz, over the ${kb(budgets[engine])} budget`);
    }
    for (const path of chunks.filter((p) => initial.includes(p))) {
      problems.push(`${engine} chunk ${path} is in the initial chunks (must load lazily)`);
    }
  }
  return { entries, problems };
}

const kb = (bytes) => `${(bytes / KB).toFixed(2)} kB`;

/** A plain-text table of the measured entries. */
export function formatTable(entries) {
  const rows = entries.map(({ name, files, gzip, budget }) => [
    name,
    String(files.length),
    kb(gzip),
    kb(budget),
    gzip <= budget ? 'ok' : 'OVER',
  ]);
  const all = [['bundle', 'files', 'gzip', 'budget', ''], ...rows];
  const widths = all[0].map((_, i) => Math.max(...all.map((row) => row[i].length)));
  return all.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ')).join('\n');
}

/** Dist-relative (POSIX) paths of every .js file under `dir`. */
const listScripts = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => posix.join(relative(dir, entry.parentPath).split(sep).join('/'), entry.name));

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dist = process.argv[2] ?? 'dist';
  const base = normaliseBase(process.argv[3] ?? process.env.VITE_BASE ?? '/');
  const reportFile = process.argv[4] ?? join('dist-report', 'bundle-budget.json');
  if (!existsSync(join(dist, 'index.html'))) {
    process.stderr.write(`${dist}/index.html not found: run \`npm run build\` first.\n`);
    process.exit(1);
  }
  const { entries, problems } = checkBundleBudget({
    html: readFileSync(join(dist, 'index.html'), 'utf8'),
    files: listScripts(dist),
    read: (path) => readFileSync(join(dist, path)),
    base,
  });
  process.stdout.write(`${formatTable(entries)}\n`);
  mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(
    reportFile,
    `${JSON.stringify({ unit: 'gzip bytes', entries, problems }, null, 2)}\n`,
  );
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`${dist}: ${p}\n`);
    process.exit(1);
  }
  process.stdout.write(`${dist}: bundle budgets ok (report: ${reportFile}).\n`);
}
