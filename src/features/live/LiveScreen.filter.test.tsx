// LIV-04: the quick filter above the channel list — accent/case-insensitive, numbers first, Esc
// clears, keyboard navigation of the results, polite result count (fake-indexeddb).
import 'fake-indexeddb/auto';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { itemKey, settingsRepo, wipeAll } from '@/core/db';
import { clearLiveState } from './liveState';
import { PageCache } from './pageCache';
import { SOURCE_ID, installScrollMetrics, renderLive, seedCatalog } from './test-utils';

let restoreScroll: () => void;
let media: { restore(): void } | undefined;

beforeAll(async () => {
  await seedCatalog();
}, 60_000);
afterAll(async () => {
  await wipeAll();
});
beforeEach(() => {
  restoreScroll = installScrollMetrics();
});
afterEach(async () => {
  cleanup();
  restoreScroll();
  media?.restore();
  media = undefined;
  await settingsRepo.set('activeSourceId', SOURCE_ID);
  await clearLiveState();
});

function show(path: string) {
  const view = renderLive(path);
  media = view.media;
  return view;
}

const listbox = (name: string | RegExp = /^Channels in/) =>
  screen.findByRole('listbox', { name }, { timeout: 5000 });
const field = () => screen.getByRole('searchbox', { name: 'Filter channels' });
const optionNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole('option')
    .map((o) => /Channel \d+/.exec(o.textContent ?? '')?.[0]);
/** The screen's polite live region (StateView has a status role of its own). */
const status = () =>
  screen.getAllByRole('status').find((el) => el.getAttribute('aria-live') === 'polite') ??
  document.body;
/** First use in a 20 000-row category builds its index from fake-indexeddb (slow in jsdom). */
const SLOW = { timeout: 30_000 };

describe('LIV-04 — quick channel filter', () => {
  it('filters the current category ignoring case and accents, and announces the count', async () => {
    show('/live/category/20');
    await listbox('Channels in Sports');
    await userEvent.type(field(), 'CHÂNNEL 7');
    await waitFor(() => expect(status()).toHaveTextContent('1 channel matches'));
    const list = await listbox('Channels in Sports');
    expect(optionNames(list)).toEqual(['Channel 7']);
    expect(within(list).getAllByRole('option')[0]).toHaveAttribute('aria-setsize', '1');
  });

  it(
    'a number puts that channel number first (20 000 channels in "All")',
    { timeout: 60_000 },
    async () => {
      show('/live');
      await listbox('Channels in All');
      await userEvent.type(field(), '101');
      // 101, then the channels whose name contains "101" (1010–1019, 10100–10199…).
      await waitFor(() => expect(status()).toHaveTextContent(/^\d+ channels match$/), SLOW);
      const list = await listbox('Channels in All');
      await waitFor(() => expect(optionNames(list)[0]).toBe('Channel 101'));
      expect(optionNames(list)[1]).toBe('Channel 1010');
    },
  );

  it('Esc clears the filter and the whole category is back', async () => {
    show('/live/category/10');
    await listbox('Channels in News');
    await userEvent.type(field(), 'channel 4');
    await waitFor(() => expect(optionNames(screen.getByRole('listbox'))).toEqual(['Channel 4']));
    await userEvent.keyboard('{Escape}');
    expect(field()).toHaveValue('');
    const list = await listbox('Channels in News');
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(5));
  });

  it(
    '↓ moves into the results, which keep their keyboard navigation (Enter plays)',
    { timeout: 60_000 },
    async () => {
      const { router } = show('/live/category/30');
      await listbox('Channels in Mega');
      await userEvent.type(field(), 'channel 1999');
      await waitFor(() => expect(status()).toHaveTextContent('11 channels match'), SLOW);
      await userEvent.keyboard('{ArrowDown}');
      const list = await listbox('Channels in Mega');
      expect(list).toHaveFocus();
      // Rows are read from IndexedDB a page at a time: wait until the target row is loaded so the
      // keys act on a real row, not a loading placeholder (load-sensitive otherwise).
      await within(list).findByText('Channel 19990', undefined, SLOW);
      await userEvent.keyboard('{ArrowDown}{Enter}');
      await waitFor(() =>
        expect(new URLSearchParams(router.state.location.search).get('channel')).toBe(
          itemKey(SOURCE_ID, 'live', '19990'),
        ),
      );
    },
  );

  it('no match shows an empty state with a way to clear the filter', async () => {
    show('/live/category/10');
    await listbox('Channels in News');
    await userEvent.type(field(), 'zzz');
    expect(await screen.findByRole('heading', { name: 'No channels match “zzz”' })).toBeVisible();
    expect(status()).toHaveTextContent('No channels match');
    // Two ways: the empty state's button (last) and the field's own clear button.
    const buttons = screen.getAllByRole('button', { name: 'Clear filter' });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[1] as HTMLElement);
    expect(field()).toHaveValue('');
    await listbox('Channels in News');
  });

  it('another category starts unfiltered', async () => {
    show('/live/category/10');
    await listbox('Channels in News');
    await userEvent.type(field(), 'channel 2');
    await waitFor(() => expect(optionNames(screen.getByRole('listbox'))).toEqual(['Channel 2']));
    await userEvent.click(screen.getByRole('link', { name: 'Sports' }));
    const list = await listbox('Channels in Sports');
    expect(field()).toHaveValue('');
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(5));
  });

  it('a failed index build keeps the list and offers a retry under the field', async () => {
    const build = vi.spyOn(PageCache.prototype, 'filterIndex').mockRejectedValue(new Error('idb'));
    show('/live/category/10');
    await listbox('Channels in News');
    await userEvent.type(field(), 'channel 4');
    const alert = await screen.findByTestId('filter-error');
    expect(alert).toHaveTextContent("Couldn't filter this category. The full list is shown.");
    // The list is still there (unfiltered), not an error page.
    const list = await listbox('Channels in News');
    expect(within(list).getAllByRole('option')).toHaveLength(5);
    expect(screen.queryByRole('heading', { name: "Couldn't load the channels" })).toBeNull();
    build.mockRestore();
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(optionNames(screen.getByRole('listbox'))).toEqual(['Channel 4']));
    expect(screen.queryByTestId('filter-error')).toBeNull();
  });

  it('the clear button empties the field', async () => {
    show('/live/category/10');
    await listbox('Channels in News');
    await userEvent.type(field(), 'channel');
    act(() => screen.getByRole('button', { name: 'Clear filter' }).click());
    expect(field()).toHaveValue('');
  });
});
