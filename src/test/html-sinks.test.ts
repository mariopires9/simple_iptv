// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// SEC-01 AC3: external metadata is rendered as text only; HTML sinks are forbidden by lint.
const eslint = new ESLint();
const SINK_RULES = new Set(['no-restricted-syntax', 'no-restricted-properties']);

async function sinkErrors(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId !== null && SINK_RULES.has(m.ruleId));
}

describe('HTML sink lint rules (SEC-01 AC3)', () => {
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
