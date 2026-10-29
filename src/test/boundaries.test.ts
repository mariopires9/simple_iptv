// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function boundaryErrors(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports');
}

// Linting through the ESLint API is slow (typescript-eslint parser): allow more than the
// default 5 s on a loaded machine or under coverage.
describe('module boundaries (FND-01 AC5)', { timeout: 30_000 }, () => {
  it.each([
    ['src/core/db/x.ts', "import { a } from '@/features/live';"],
    ['src/core/net/x.ts', "import { a } from '@/providers/xtream';"],
    ['src/providers/m3u/x.ts', "import { a } from '@/player';"],
    ['src/player/x.ts', "import { a } from '@/features/live';"],
    ['src/ui/x.ts', "import { a } from '@/app/App';"],
    ['src/features/movies/x.ts', "import { a } from '@/features/series';"],
    ['src/core/worker/x.ts', "import { a } from '@/worker';"],
    ['src/core/worker/x.ts', "import { a } from '@/providers/xtream';"],
    ['src/providers/xtream/x.ts', "import { a } from '@/worker';"],
    ['src/worker/x.ts', "import { a } from '@/features/sources';"],
    ['src/worker/x.ts', "import { a } from '@/ui';"],
    ['src/worker/x.ts', "import { a } from '@/app/App';"],
  ])('%s cannot do %s', async (file, src) => {
    expect(await boundaryErrors(file, `${src}\nexport const b = a;\n`)).toHaveLength(1);
  });

  it.each([
    ['src/features/live/x.ts', "import { a } from '@/core/db';"],
    ['src/features/live/x.ts', "import { a } from '@/player';"],
    ['src/providers/xtream/x.ts', "import { a } from '@/core/net';"],
    ['src/app/x.ts', "import { a } from '@/features/live';"],
    ['src/worker/x.ts', "import { a } from '@/providers/xtream';"],
    ['src/worker/x.ts', "import { a } from '@/core/worker';"],
    ['src/features/sources/x.ts', "import { a } from '@/worker';"],
  ])('%s can do %s', async (file, src) => {
    expect(await boundaryErrors(file, `${src}\nexport const b = a;\n`)).toHaveLength(0);
  });

  // TEC-01: the full string catalogs are for tests and tooling only.
  const CATALOGS = ['@', 'i18n', 'catalogs'].join('/');
  it.each([
    ['src/app/x.tsx', `import { messages } from '${CATALOGS}';`],
    ['src/features/live/x.ts', `import { messages } from '${CATALOGS}';`],
    ['src/ui/state/x.ts', `import { messages } from '${CATALOGS}';`],
    ['src/player/ui/x.ts', `import { messages } from '${CATALOGS}';`],
    ['src/core/log/x.ts', `import { messages } from '${CATALOGS}';`],
    ['src/i18n/x.ts', "import { messages } from './catalogs';"],
    ['src/i18n/en/x.ts', "import { messages } from '../catalogs';"],
  ])('%s (not a test) cannot do %s', async (file, src) => {
    const errors = await boundaryErrors(file, `${src}\nexport const b = messages;\n`);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('tests and tooling only');
  });

  it.each([
    'src/app/x.test.tsx',
    'src/features/live/x.test.ts',
    'src/ui/state/x.test.ts',
    'src/player/ui/x.test.tsx',
    'src/core/log/x.test.ts',
    'src/i18n/x.test.ts',
    'src/test/x.ts',
    'src/ui/test-utils/x.ts',
  ])('%s (test or test helper) can import the catalogs', async (file) => {
    const src = `import { messages } from '${CATALOGS}';\nexport const b = messages;\n`;
    expect(await boundaryErrors(file, src)).toHaveLength(0);
  });

  it('test files keep their layer boundaries', async () => {
    const src = "import { a } from '@/features/live';\nexport const b = a;\n";
    expect(await boundaryErrors('src/core/db/x.test.ts', src)).toHaveLength(1);
    expect(await boundaryErrors('src/features/movies/x.test.tsx', src)).toHaveLength(1);
  });
});
