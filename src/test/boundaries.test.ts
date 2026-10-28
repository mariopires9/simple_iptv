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
  ])('%s cannot do %s', async (file, src) => {
    expect(await boundaryErrors(file, `${src}\nexport const b = a;\n`)).toHaveLength(1);
  });

  it.each([
    ['src/features/live/x.ts', "import { a } from '@/core/db';"],
    ['src/features/live/x.ts', "import { a } from '@/player';"],
    ['src/providers/xtream/x.ts', "import { a } from '@/core/net';"],
    ['src/app/x.ts', "import { a } from '@/features/live';"],
  ])('%s can do %s', async (file, src) => {
    expect(await boundaryErrors(file, `${src}\nexport const b = a;\n`)).toHaveLength(0);
  });
});
