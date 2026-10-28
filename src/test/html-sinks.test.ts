// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// SEC-01 AC3: external metadata is rendered as text only; HTML sinks are forbidden by lint.
const eslint = new ESLint();
const SINK_RULES = new Set(['no-restricted-syntax', 'no-restricted-properties']);

async function sinkErrors(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath });
  // A parse error would make "allows" cases pass vacuously.
  expect((result?.messages ?? []).filter((m) => m.fatal)).toEqual([]);
  return (result?.messages ?? []).filter((m) => m.ruleId !== null && SINK_RULES.has(m.ruleId));
}

// Linting through the ESLint API is slow (typescript-eslint parser): allow more than the
// default 5 s on a loaded machine or under coverage.
describe('HTML sink lint rules (SEC-01 AC3)', { timeout: 30_000 }, () => {
  it.each([
    [
      'src/features/live/x.tsx',
      'export const C = ({ s }: { s: string }) => <div dangerouslySetInnerHTML={{ __html: s }} />;',
    ],
    ['src/ui/x.tsx', 'export const C = () => <p dangerouslySetInnerHTML={{ __html: "" }} />;'],
    [
      'src/features/live/x.ts',
      'export const f = (el: HTMLElement, s: string) => { el.innerHTML = s; };',
    ],
    ['src/core/db/x.ts', 'export const f = (el: Element, s: string) => { el.outerHTML = s; };'],
    ['src/ui/x.ts', 'export const f = (el: Element, s: string) => { el.innerHTML += s; };'],
    ['src/ui/x.ts', "export const f = (el: Element, s: string) => { el['innerHTML'] = s; };"],
    ['src/ui/x.ts', "export const f = (el: Element, s: string) => { el['outerHTML'] = s; };"],
    [
      'src/ui/x.ts',
      'export const f = (s: string) => { document.body.firstElementChild!.innerHTML = s; };',
    ],
    [
      'src/player/x.ts',
      "export const f = (el: Element, s: string) => { el.insertAdjacentHTML('beforeend', s); };",
    ],
    [
      'src/ui/x.ts',
      "export const f = (el: Element, s: string) => { el['insertAdjacentHTML']('afterbegin', s); };",
    ],
  ])('%s: forbids %s', async (file, src) => {
    expect(await sinkErrors(file, `${src}\n`)).toHaveLength(1);
  });

  // Review findings: broader sink coverage (one violation per snippet).
  const F = 'export const f = (el: HTMLIFrameElement, s: string) => {';
  it.each([
    `${F} el[\`innerHTML\`] = s; };`,
    `${F} el[\`outerHTML\`] = s; };`,
    `${F} el.srcdoc = s; };`,
    `${F} el['srcdoc'] = s; };`,
    `${F} el[\`srcdoc\`] = s; };`,
    `${F} Object.assign(el, { innerHTML: s }); };`,
    `${F} Object.assign(el, { outerHTML: s }); };`,
    `${F} Object.assign(el, { srcdoc: s }); };`,
    `${F} Object.assign(el, { 'innerHTML': s }); };`,
    `${F} Object.assign(el, { [\`innerHTML\`]: s }); };`,
    `${F} const innerHTML = s; Object.assign(el, { innerHTML }); };`,
    `${F} document.write(s); };`,
    `${F} document.writeln(s); };`,
    `${F} document.createRange().createContextualFragment(s); };`,
    `${F} el.setHTMLUnsafe(s); };`,
    `${F} (Document as unknown as { parseHTMLUnsafe(x: string): Document }).parseHTMLUnsafe(s); };`,
    `${F} new DOMParser().parseFromString(s, 'text/html'); };`,
    `${F} new DOMParser().parseFromString(s, "TEXT/HTML"); };`,
    `${F} new DOMParser().parseFromString(s, \`text/html\`); };`,
    `${F} new DOMParser().parseFromString(s, 'application/xhtml+xml'); };`,
    `${F} new DOMParser().parseFromString(s, 'image/svg+xml'); };`,
  ])('forbids %s', async (src) => {
    expect(await sinkErrors('src/ui/x.ts', `${src}\n`)).toHaveLength(1);
  });

  it('forbids srcDoc on JSX iframes', async () => {
    const src = 'export const C = ({ s }: { s: string }) => <iframe title="t" srcDoc={s} />;\n';
    expect(await sinkErrors('src/ui/x.tsx', src)).toHaveLength(1);
  });

  it.each([
    // A computed key held in a variable named like the sink is not a false positive (it is also
    // not statically detectable, which is why lint is defence-in-depth alongside the CSP).
    `${F} const innerHTML = 'title'; el[innerHTML] = s; };`,
    `${F} const k = 'inner' + 'HTML'; (el as unknown as Record<string, string>)[k] = s; };`,
    `${F} const { innerHTML } = el; return innerHTML + s; };`,
    `${F} return new DOMParser().parseFromString(s, 'application/xml'); };`,
    `${F} return new DOMParser().parseFromString(s, 'text/xml'); };`,
    `${F} el.title = s; };`,
  ])('allows %s', async (src) => {
    expect(await sinkErrors('src/ui/x.ts', `${src}\n`)).toHaveLength(0);
  });

  it.each([
    ['src/ui/x.tsx', 'export const C = ({ s }: { s: string }) => <p>{s}</p>;'],
    ['src/ui/x.ts', 'export const f = (el: Element, s: string) => { el.textContent = s; };'],
    ['src/ui/x.ts', 'export const f = (el: Element) => el.innerHTML;'],
    [
      'src/ui/x.ts',
      "export const f = (el: Element, s: string) => { el.insertAdjacentText('beforeend', s); };",
    ],
  ])('%s: allows %s', async (file, src) => {
    expect(await sinkErrors(file, `${src}\n`)).toHaveLength(0);
  });
});
