import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkBundleBudget } from './check-bundle-budget.mjs';

// A synthetic dist/: an entry with one modulepreload, a statically imported shared chunk, and the
// two playback engines reached only through import(). Random bytes barely compress, so a file of
// N random bytes is ≈ N gzip bytes.
const pad = (bytes) => `/*${randomBytes(bytes).toString('base64')}*/`;

function dist({ entryImportsHls = false } = {}) {
  const files = {
    'assets/index-a1.js':
      `import{r as e}from"./react-b2.js";import"./shared-c3.js";` +
      (entryImportsHls ? `import t from"./hls-d4.js";` : '') +
      'const l=()=>import(`./hls-d4.js`),m=()=>import("./mpegts-e5.js");' +
      pad(2_000),
    'assets/react-b2.js': `export const r=1;${pad(3_000)}`,
    'assets/shared-c3.js': `export{r}from"./react-b2.js";${pad(1_000)}`,
    'assets/lazy-f6.js': `import{r}from"./react-b2.js";${pad(50_000)}`,
    'assets/hls-d4.js': `export default 1;${pad(4_000)}`,
    'assets/mpegts-e5.js': `export default 2;${pad(2_000)}`,
  };
  const html =
    '<!doctype html><html><head>' +
    '<script type="module" crossorigin src="/simple_iptv/assets/index-a1.js"></script>' +
    '<link rel="modulepreload" crossorigin href="/simple_iptv/assets/react-b2.js">' +
    '</head><body></body></html>';
  return {
    html,
    files: Object.keys(files),
    read: (path) => Buffer.from(files[path]),
    base: '/simple_iptv/',
  };
}

const BUDGETS = { initial: 10_000, hls: 8_000, mpegts: 4_000 };

describe('check-bundle-budget (QA-03 AC2)', () => {
  it('passes a build within budget with both engines lazily loaded', () => {
    const { entries, problems } = checkBundleBudget({ ...dist(), budgets: BUDGETS });
    expect(problems).toEqual([]);
    const initial = entries.find((e) => e.name === 'initial JS');
    // Static imports are followed (shared-c3.js); the lazy screen and the engines are not.
    expect(initial.files.sort()).toEqual([
      'assets/index-a1.js',
      'assets/react-b2.js',
      'assets/shared-c3.js',
    ]);
    expect(entries.map((e) => [e.name, e.files])).toEqual([
      ['initial JS', expect.any(Array)],
      ['hls', ['assets/hls-d4.js']],
      ['mpegts', ['assets/mpegts-e5.js']],
    ]);
  });

  it.each([
    ['initial', { ...BUDGETS, initial: 5_000 }, 'initial JS is'],
    ['hls', { ...BUDGETS, hls: 3_000 }, 'hls chunk is'],
    ['mpegts', { ...BUDGETS, mpegts: 1_000 }, 'mpegts chunk is'],
  ])('fails when the %s bundle is over budget', (_, budgets, problem) => {
    const { problems } = checkBundleBudget({ ...dist(), budgets });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(problem);
  });

  it('fails when a playback engine is in the initial chunks', () => {
    const big = { initial: 1_000_000, hls: 1_000_000, mpegts: 1_000_000 };
    const { problems } = checkBundleBudget({ ...dist({ entryImportsHls: true }), budgets: big });
    expect(problems).toEqual([
      'hls chunk assets/hls-d4.js is in the initial chunks (must load lazily)',
    ]);
  });
});
