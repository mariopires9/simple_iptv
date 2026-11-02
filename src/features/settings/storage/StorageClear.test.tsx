// STO-01 — Settings › Storage: breakdown with "about" sizes and a spinner, cancelled on unmount
// (AC1); the "Clear cached data" dialog, its defaults and accessible hints (AC2/AC6); restart after
// a catalogue clear (AC4); the space used refreshed after clearing (AC6).
import 'fake-indexeddb/auto';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageStatus } from '@/core/platform';
import { t } from '@/i18n';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { StorageSection } from '../sections/StorageSection';
import { renderSettings } from '../test-utils';
import type { StorageBreakdown } from './storageUsage';

const text = t.settings.storage;
const breakdownText = text.breakdown;
const clearText = text.clear;
const MB = 1_000_000;

let media: ReturnType<typeof installMatchMedia>;
beforeEach(() => {
  media = installMatchMedia({ width: 1200 });
});
afterEach(() => {
  media.restore();
});

const desktop = { isIOS: () => false, isInstalled: () => false };
const status = (fields: Partial<StorageStatus>): StorageStatus => ({
  persisted: true,
  canPersist: true,
  ...fields,
});

const list = (id: string, name: string, kind: 'xtream' | 'm3u-file' = 'xtream') => ({
  sourceId: id,
  name,
  kind,
  catalogue: { live: 1200, movie: 30, series: 4, episodes: 2, bytes: 300 * MB },
  search: { rows: 1, bytes: 20 * MB },
  guide: { rows: 5000, bytes: 5 * MB },
});
const data: StorageBreakdown = {
  lists: [list('a', 'Home'), list('b', 'Pocket', 'm3u-file')],
  appFiles: 2 * MB,
  otherCaches: 0,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('Settings › Storage breakdown (STO-01 AC1)', () => {
  it('shows a spinner, then per-list and app sizes labelled "about"; cancels on unmount', async () => {
    const pending = deferred<StorageBreakdown>();
    let signal: AbortSignal | undefined;
    const view = renderSettings(
      <StorageSection
        {...desktop}
        loadStatus={() => Promise.resolve(status({ usage: 509.4 * MB }))}
        loadBreakdown={(s) => {
          signal = s;
          return pending.promise;
        }}
      />,
    );
    expect(await screen.findByText(breakdownText.loading)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: clearText.action })).toBeDisabled();
    pending.resolve(data);
    const breakdown = await screen.findByTestId('storage-breakdown');
    expect(breakdown).toHaveTextContent('Home');
    expect(breakdown).toHaveTextContent(breakdownText.catalogueCounts('1,200', '30', '4', '2'));
    expect(screen.getAllByText(breakdownText.about('300 MB'))).toHaveLength(2);
    expect(screen.getAllByText(breakdownText.about('20 MB'))).toHaveLength(2);
    expect(screen.getAllByText(breakdownText.about('5 MB'))).toHaveLength(2);
    expect(screen.getByText(breakdownText.about('2 MB'))).toBeInTheDocument();
    expect(breakdown).toHaveTextContent(breakdownText.images);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('the real estimate runs on an empty device without lists', async () => {
    renderSettings(
      <StorageSection {...desktop} loadStatus={() => Promise.resolve(status({ usage: 0 }))} />,
    );
    expect(await screen.findByText(breakdownText.noLists)).toBeInTheDocument();
  });
});

describe('Settings › Storage › Clear cached data (STO-01 AC2, AC4, AC6)', () => {
  it('defaults to guide + search indexes, no catalogue; clearing refreshes the total', async () => {
    const user = userEvent.setup();
    let usage = 509.4 * MB;
    const loadStatus = vi.fn(() => Promise.resolve(status({ usage })));
    const loadBreakdown = vi.fn(() => Promise.resolve(data));
    const clear = vi.fn(() => {
      usage = 480 * MB;
      return Promise.resolve({ failed: [], clearedLists: [] });
    });
    const restart = vi.fn();
    renderSettings(
      <StorageSection
        {...desktop}
        loadStatus={loadStatus}
        loadBreakdown={loadBreakdown}
        clear={clear}
        restart={restart}
      />,
    );
    expect(await screen.findByText('509.4 MB')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: clearText.action }));
    const dialog = await screen.findByRole('dialog', { name: clearText.title });
    const guide = within(dialog).getByRole('checkbox', {
      name: `${clearText.guide} (${clearText.size('10 MB')})`,
    });
    expect(guide).toBeChecked();
    expect(guide).toHaveAccessibleDescription(clearText.guideHint);
    const search = within(dialog).getByRole('checkbox', {
      name: `${clearText.search} (${clearText.size('40 MB')})`,
    });
    expect(search).toBeChecked();
    expect(search).toHaveAccessibleDescription(clearText.searchHint);
    // A list's catalogue goes with its search index.
    expect(
      within(dialog).getByRole('checkbox', { name: `Home (${clearText.size('320 MB')})` }),
    ).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: clearText.allLists })).not.toBeChecked();
    expect(within(dialog).getByText(clearText.catalogueHint)).toBeInTheDocument();
    expect(within(dialog).getByText(clearText.fileListHint)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: clearText.confirm }));
    expect(clear).toHaveBeenCalledWith({
      guide: true,
      search: true,
      otherCaches: false,
      catalogue: [],
    });
    expect(await screen.findByText(clearText.done)).toHaveAttribute('role', 'status');
    expect(await screen.findByText('480 MB')).toBeInTheDocument();
    expect(loadBreakdown).toHaveBeenCalledTimes(2);
    expect(restart).not.toHaveBeenCalled();
  });

  it('clearing lists’ catalogue restarts the app', async () => {
    const user = userEvent.setup();
    const clear = vi.fn(() => Promise.resolve({ failed: [], clearedLists: ['a', 'b'] }));
    const restart = vi.fn();
    renderSettings(
      <StorageSection
        {...desktop}
        loadStatus={() => Promise.resolve(status({ usage: 1 }))}
        loadBreakdown={() => Promise.resolve(data)}
        clear={clear}
        restart={restart}
      />,
    );
    await user.click(await screen.findByRole('button', { name: clearText.action }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: /^Search indexes/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /^Guide/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: clearText.allLists }));
    await user.click(within(dialog).getByRole('button', { name: clearText.confirm }));
    expect(clear).toHaveBeenCalledWith({
      guide: false,
      search: false,
      otherCaches: false,
      catalogue: ['a', 'b'],
    });
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  });

  it('nothing selected disables Clear; a failure is reported and can be retried', async () => {
    const user = userEvent.setup();
    const clear = vi
      .fn()
      .mockResolvedValueOnce({ failed: ['guide'], clearedLists: [] })
      .mockResolvedValueOnce({ failed: [], clearedLists: [] });
    renderSettings(
      <StorageSection
        {...desktop}
        loadStatus={() => Promise.resolve(status({ usage: 1 }))}
        loadBreakdown={() => Promise.resolve(data)}
        clear={clear}
      />,
    );
    await user.click(await screen.findByRole('button', { name: clearText.action }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: clearText.confirm });
    await user.click(within(dialog).getByRole('checkbox', { name: /^Search indexes/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /^Guide/ }));
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: /^Guide/ }));
    await user.click(confirm);
    expect(await within(dialog).findByText(clearText.failed)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: clearText.confirm }));
    expect(await screen.findByText(clearText.done)).toBeInTheDocument();
  });
});
