// EPG-04 — guide screen over an M3U list with a stored XMLTV guide: programmes from IndexedDB,
// details dialog, play from the grid (opens Live on the channel), parental control (SEC-03) and
// "Hide protected content" (UX-07).
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  catalogRepo,
  categoryKey,
  epgRepo,
  itemKey,
  settingsRepo,
  sourcesRepo,
  wipeAll,
} from '@/core/db';
import { forgetActiveSource } from '@/core/session';
import {
  lockParental,
  resetParentalForTests,
  setParentalPin,
  setRestrictedCategories,
} from '@/core/session/parental';
import { t } from '@/i18n';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { m3uSource } from '@/ui/test-utils/sources';
import { installGridMetrics } from './guide-test-utils';
import { GuideScreen } from './GuideScreen';

const SOURCE = 'g1';
const HOUR = 3_600_000;
const TOON = itemKey(SOURCE, 'live', 'k1');

beforeAll(async () => {
  const now = Date.now();
  await sourcesRepo.put({
    ...m3uSource(SOURCE, 'List', 1),
    epgStatus: { status: 'ok', at: now, lastOkAt: now },
    protectedCounts: { live: 1, movies: 0, series: 0 },
  });
  await catalogRepo.replaceForSource(SOURCE, 'live', {
    categories: [
      { externalId: 'kids', name: 'Kids' },
      { externalId: 'adult', name: 'Adult' },
    ],
    items: [
      {
        externalId: 'k1',
        categoryExternalId: 'kids',
        name: 'Toon TV',
        streamPath: '',
        streamUrl: 'https://cdn.example.test/k1.m3u8',
      },
      {
        externalId: 'k2',
        categoryExternalId: 'kids',
        name: 'Locked Box',
        streamPath: '',
        streamUrl: 'https://cdn.example.test/k2.mpd',
        drm: true,
      },
      {
        externalId: 'a1',
        categoryExternalId: 'adult',
        name: 'Night TV',
        streamPath: '',
        streamUrl: 'https://cdn.example.test/a1.m3u8',
      },
    ],
  });
  await epgRepo.replaceForExistingSource(SOURCE, [
    {
      channelEpgId: TOON,
      sourceId: SOURCE,
      start: now - HOUR / 2,
      end: now + HOUR / 2,
      title: 'Morning <b>Cartoons</b>',
      desc: 'Talking animals.',
    },
    {
      channelEpgId: TOON,
      sourceId: SOURCE,
      start: now + HOUR / 2,
      end: now + HOUR,
      title: 'Puzzles',
    },
  ]);
  await settingsRepo.set('activeSourceId', SOURCE);
});
afterAll(async () => {
  await wipeAll();
});

let restoreMetrics: () => void;
let media: { restore(): void } | undefined;
beforeEach(async () => {
  restoreMetrics = installGridMetrics();
  resetParentalForTests({ iterations: 1_000 });
  await setParentalPin('1234');
  await setRestrictedCategories(`${SOURCE}:live:`, [categoryKey(SOURCE, 'live', 'adult')]);
  lockParental();
});
afterEach(async () => {
  cleanup();
  restoreMetrics();
  media?.restore();
  media = undefined;
  forgetActiveSource();
  resetParentalForTests();
  await settingsRepo.remove('parentalControl');
  await settingsRepo.remove('hideProtectedContent');
});

function show(path = '/live/guide') {
  media = installMatchMedia({ width: 1400 });
  const router = createMemoryRouter(
    [
      { path: '/live/guide', Component: GuideScreen },
      { path: '/live/category/:categoryId', element: <p>Live screen</p> },
      { path: '*', element: null },
    ],
    { initialEntries: [path] },
  );
  render(
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>,
  );
  return router;
}

const grid = () => screen.findByRole('grid', {}, { timeout: 5000 });

describe('EPG-04 — guide screen', () => {
  it('shows the stored guide as text and opens a programme’s details', async () => {
    const router = show();
    const cell = await within(await grid()).findByRole(
      'gridcell',
      { name: /^Morning <b>Cartoons<\/b>, .*, on now$/ },
      { timeout: 5000 },
    );
    // Untrusted programme text is rendered literally, never as markup.
    expect(document.querySelector('b')).toBeNull();
    await userEvent.click(cell);
    const dialog = await screen.findByRole('dialog', { name: 'Morning <b>Cartoons</b>' });
    expect(within(dialog).getByText('Talking animals.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: t.live.guide.details.watch }));
    await waitFor(() =>
      expect(router.state.location.search).toBe(`?channel=${encodeURIComponent(TOON)}`),
    );
    expect(router.state.location.pathname).toBe('/live/category/~all');
  });

  it('leaves locked categories and their channels out (SEC-03)', async () => {
    show();
    const g = await grid();
    await within(g).findByText('Toon TV');
    expect(within(g).queryByText('Night TV')).toBeNull();
    await userEvent.click(screen.getByRole('combobox', { name: t.live.guide.category }));
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Kids');
    expect(options).not.toContain('Adult');
  });

  it('a locked category in the URL falls back to "All" (SEC-03)', async () => {
    show('/live/guide?category=adult');
    const g = await grid();
    await within(g).findByText('Toon TV');
    expect(within(g).queryByText('Night TV')).toBeNull();
  });

  it('never plays a protected channel and hides it when asked (UX-07)', async () => {
    const router = show();
    const g = await grid();
    await userEvent.click(await within(g).findByText('Locked Box'));
    expect(await screen.findByRole('status')).toHaveTextContent(
      t.state.protectedContent.unplayable,
    );
    expect(router.state.location.pathname).toBe('/live/guide');
    cleanup();

    await settingsRepo.set('hideProtectedContent', true);
    show();
    const hidden = await grid();
    await within(hidden).findByText('Toon TV');
    expect(within(hidden).queryByText('Locked Box')).toBeNull();
  });
});
