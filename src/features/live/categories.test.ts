// SRC-04 AC9 review: the synthetic M3U "Uncategorized" category is stored without a name and
// localised when displayed.
import { describe, expect, it } from 'vitest';
import type { Category } from '@/core/db';
import { t } from '@/i18n';
import { UNCATEGORIZED_CATEGORY_ID } from '@/providers/m3u';
import { buildCategories } from './categories';

const category = (externalId: string, name: string, order: number): Category => ({
  key: `s1:live:cat:${externalId}`,
  sourceId: 's1',
  type: 'live',
  externalId,
  name,
  order,
});

describe('buildCategories — Uncategorized', () => {
  it('localises the nameless synthetic category and keeps other names as stored', () => {
    const list = buildCategories([
      category('g1', 'News', 0),
      category(UNCATEGORIZED_CATEGORY_ID, '', 1),
    ]);
    expect(list.slice(3).map((c) => c.name)).toEqual(['News', t.live.uncategorized]);
  });

  it('a provider category that happens to use the same id keeps its own name', () => {
    const list = buildCategories([category(UNCATEGORIZED_CATEGORY_ID, 'Misc', 0)]);
    expect(list[3]?.name).toBe('Misc');
  });
});
