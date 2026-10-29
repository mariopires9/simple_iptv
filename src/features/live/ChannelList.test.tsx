import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Channel } from '@/core/db';
import { ThemeModeProvider } from '@/ui/theme';
import { ChannelList } from './ChannelList';
import { PageCache } from './pageCache';
import { installScrollMetrics } from './test-utils';

const channel = (i: number) =>
  ({ key: `s:live:${i}`, name: `Channel ${i}`, order: i, nameNorm: '' }) as Channel;

function cacheOf(total: number) {
  const rows = Array.from({ length: total }, (_, i) => channel(i + 1));
  return new PageCache({
    total,
    load: (offset, limit) => Promise.resolve(rows.slice(offset, offset + limit)),
    locate: (c) => Promise.resolve(rows.findIndex((r) => r.key === c.key)),
  });
}

let restore: () => void;
beforeEach(() => {
  restore = installScrollMetrics();
});
afterEach(() => restore());

function show(cache: PageCache, initialIndex: number) {
  return render(
    <ThemeModeProvider>
      <ChannelList
        cache={cache}
        label="Channels"
        favorites={new Set()}
        onPlay={() => {}}
        onToggleFavorite={() => {}}
        initialIndex={initialIndex}
      />
    </ThemeModeProvider>,
  );
}

const active = () => {
  const id = screen.getByRole('listbox').getAttribute('aria-activedescendant');
  return id === null ? null : document.getElementById(id);
};

describe('ChannelList', () => {
  it('clamps the selected row to the list size', async () => {
    show(cacheOf(3), 50);
    await waitFor(() => expect(active()).toHaveAttribute('aria-posinset', '3'));
  });
});
