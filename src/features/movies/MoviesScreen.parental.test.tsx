// SEC-03 — parental control in Movies: while locked, a restricted category shows a lock and asks
// for the PIN before its grid is shown, its movies are left out of "All", and a restricted movie's
// details (and Play) need the PIN. The right PIN unlocks for the session.
import 'fake-indexeddb/auto';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRepo, categoryKey, settingsRepo, sourcesRepo, wipeAll } from '@/core/db';
import { forgetActiveSource } from '@/core/session';
import {
  lockParental,
  resetParentalForTests,
  setParentalPin,
  setRestrictedCategories,
} from '@/core/session/parental';
import { t } from '@/i18n';
import type { PlayerViewProps } from '@/player/ui';
import { clearProjectionCache } from '@/ui/catalog/sortIndex';
import { clearBrowseState } from './browseState';
import { installScrollMetrics, m3uSource, renderMovies } from './test-utils';

vi.mock('@/player/ui', () => ({
  PlayerView: (props: PlayerViewProps) => (
    <div role="region" aria-label={`Player: ${props.title}`} />
  ),
}));

const SOURCE = 'pm1';
const gate = t.parental.gate;

beforeAll(async () => {
  await sourcesRepo.put(m3uSource(SOURCE, 'List', 1));
  await catalogRepo.replaceForSource(SOURCE, 'movie', {
    categories: [
      { externalId: 'fam', name: 'Family' },
      { externalId: 'late', name: 'Late night' },
    ],
    items: [
      {
        externalId: 'cartoon',
        categoryExternalId: 'fam',
        name: 'Cartoon Film',
        streamPath: '',
        streamUrl: 'https://cdn.example.test/cartoon.mp4',
        container: 'mp4',
      },
      {
        externalId: 'thriller',
        categoryExternalId: 'late',
        name: 'Thriller Film',
        streamPath: '',
        streamUrl: 'https://cdn.example.test/thriller.mp4',
        container: 'mp4',
      },
    ],
  });
  await settingsRepo.set('activeSourceId', SOURCE);
});
afterAll(async () => {
  await wipeAll();
});

let restoreScroll: () => void;
let media: { restore(): void } | undefined;
beforeEach(async () => {
  restoreScroll = installScrollMetrics();
  resetParentalForTests({ iterations: 1_000 });
  await setParentalPin('1234');
  await setRestrictedCategories(`${SOURCE}:movie:`, [categoryKey(SOURCE, 'movie', 'late')]);
  lockParental();
});
afterEach(async () => {
  cleanup();
  restoreScroll();
  media?.restore();
  media = undefined;
  forgetActiveSource();
  clearProjectionCache();
  clearBrowseState();
  resetParentalForTests();
  await settingsRepo.remove('parentalControl');
});

function show(path: string) {
  const view = renderMovies(path);
  media = view.media;
  return view;
}

async function enterPin(pin: string) {
  await userEvent.click(await screen.findByRole('button', { name: gate.unlock }));
  await userEvent.type(screen.getByLabelText(t.parental.prompt.pin), pin);
  await userEvent.click(screen.getByRole('button', { name: t.parental.prompt.unlock }));
}

describe('SEC-03 — Movies', () => {
  it('leaves restricted movies out of "All" and marks the category as restricted', async () => {
    show('/movies');
    const g = await screen.findByRole('grid', { name: 'Movies in All' }, { timeout: 5000 });
    await within(g).findByRole('link', { name: 'Cartoon Film' });
    expect(within(g).getAllByRole('gridcell')).toHaveLength(1);
    expect(screen.queryByText('Thriller Film')).toBeNull();
    expect(
      screen.getByRole('link', { name: t.parental.restrictedCategory('Late night') }),
    ).toBeInTheDocument();
  });

  it('asks for the PIN before showing a restricted category; the right PIN shows it', async () => {
    show('/movies/category/late');
    expect(await screen.findByRole('heading', { name: gate.title })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
    await enterPin('9999');
    expect(await screen.findByText(t.parental.prompt.wrong)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(t.parental.prompt.pin), '1234');
    await userEvent.click(screen.getByRole('button', { name: t.parental.prompt.unlock }));
    const g = await screen.findByRole('grid', { name: 'Movies in Late night' }, { timeout: 5000 });
    expect(await within(g).findByRole('link', { name: 'Thriller Film' })).toBeInTheDocument();
    // Unlocked for the session: the lock is gone from the navigation.
    expect(screen.getByRole('link', { name: 'Late night' })).toBeInTheDocument();
  });

  it('a restricted movie needs the PIN before its details and Play are shown', async () => {
    show('/movies/thriller');
    expect(await screen.findByRole('heading', { level: 1, name: gate.title })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.movies.details.play })).toBeNull();
    expect(screen.queryByText('Thriller Film')).toBeNull();
    await enterPin('1234');
    const play = await screen.findByRole('button', { name: t.movies.details.play });
    await userEvent.click(play);
    expect(await screen.findByRole('region', { name: 'Player: Thriller Film' })).toBeVisible();
  });
});
