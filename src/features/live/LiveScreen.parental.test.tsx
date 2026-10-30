// SEC-03 — parental control in Live: while locked, a restricted category shows a lock and a PIN
// gate instead of its channels, its channels are left out of "All" and "Favorites", and a link to
// one of them never starts it. The right PIN unlocks for the session.
import 'fake-indexeddb/auto';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  catalogRepo,
  categoryKey,
  favoritesRepo,
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
  unlockParental,
} from '@/core/session/parental';
import { t } from '@/i18n';
import type { PlayerViewProps } from '@/player/ui';
import { m3uSource } from '@/ui/test-utils/sources';
import { clearLiveState } from './liveState';
import { installScrollMetrics, renderLive } from './test-utils';

const views: PlayerViewProps[] = [];
vi.mock('@/player/ui', () => ({
  PlayerView: (props: PlayerViewProps) => {
    views.push(props);
    return <div role="region" aria-label={`Player: ${props.title}`} />;
  },
}));
vi.mock('./epg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./epg')>();
  return { ...actual, createEpgService: () => undefined };
});

const SOURCE = 'pl1';
const gate = t.parental.gate;
const ADULT = itemKey(SOURCE, 'live', 'a1');

beforeAll(async () => {
  await sourcesRepo.put(m3uSource(SOURCE, 'List', 1));
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
        externalId: 'a1',
        categoryExternalId: 'adult',
        name: 'Night TV',
        streamPath: '',
        streamUrl: 'https://cdn.example.test/a1.m3u8',
      },
    ],
  });
  await favoritesRepo.add(ADULT);
  await settingsRepo.set('activeSourceId', SOURCE);
});
afterAll(async () => {
  await wipeAll();
});

let restoreScroll: () => void;
let media: { restore(): void } | undefined;
beforeEach(async () => {
  restoreScroll = installScrollMetrics();
  views.length = 0;
  resetParentalForTests({ iterations: 1_000 });
  await setParentalPin('1234');
  await setRestrictedCategories(`${SOURCE}:live:`, [categoryKey(SOURCE, 'live', 'adult')]);
  lockParental();
});
afterEach(async () => {
  cleanup();
  restoreScroll();
  media?.restore();
  media = undefined;
  forgetActiveSource();
  resetParentalForTests();
  await settingsRepo.remove('parentalControl');
  await clearLiveState();
});

function show(path: string) {
  const view = renderLive(path);
  media = view.media;
  return view;
}

const listbox = (name: string) => screen.findByRole('listbox', { name }, { timeout: 5000 });

describe('SEC-03 — Live', () => {
  it('leaves restricted channels out of "All" and "Favorites" and marks the category', async () => {
    show('/live');
    const all = await listbox(t.live.channelsIn(t.live.virtualCategories.all));
    await within(all).findByText('Toon TV');
    expect(within(all).getAllByRole('option')).toHaveLength(1);
    expect(screen.queryByText('Night TV')).toBeNull();
    expect(
      screen.getByRole('link', { name: t.parental.restrictedCategory('Adult') }),
    ).toBeInTheDocument();
    cleanup();

    show('/live/category/~favorites');
    expect(await screen.findByText(t.live.emptyFavorites.title)).toBeInTheDocument();
    expect(screen.queryByText('Night TV')).toBeNull();
  });

  it('asks for the PIN before showing a restricted category; the right PIN shows it', async () => {
    show('/live/category/adult');
    expect(await screen.findByRole('heading', { name: gate.title })).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: gate.unlock }));
    await userEvent.type(screen.getByLabelText(t.parental.prompt.pin), '1234');
    await userEvent.click(screen.getByRole('button', { name: t.parental.prompt.unlock }));
    const list = await listbox(t.live.channelsIn('Adult'));
    expect(within(list).getByText('Night TV')).toBeInTheDocument();
  });

  it('a link to a restricted channel never starts it while locked', async () => {
    const { router } = show(`/live?channel=${encodeURIComponent(ADULT)}`);
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(views).toHaveLength(0);
    cleanup();

    // Unlocked for the session: the same link plays.
    expect(await unlockParental('1234')).toBe(true);
    show(`/live?channel=${encodeURIComponent(ADULT)}`);
    expect(await screen.findByRole('region', { name: 'Player: Night TV' })).toBeInTheDocument();
  });
});
