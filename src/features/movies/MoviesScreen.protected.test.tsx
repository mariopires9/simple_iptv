// UX-07 — protected content (DRM/DASH) in Movies: the grid card and the details hero show the
// "Protected" badge, Play is disabled with the reason and the player is never opened; "Hide
// protected content" (Settings › Playback) leaves those movies out of the grid (count and empty
// state included).
import 'fake-indexeddb/auto';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRepo, settingsRepo, sourcesRepo, wipeAll } from '@/core/db';
import { forgetActiveSource } from '@/core/session';
import { t } from '@/i18n';
import type { PlayerViewProps } from '@/player/ui';
import { clearProjectionCache } from '@/ui/catalog/sortIndex';
import { clearBrowseState } from './browseState';
import { installScrollMetrics, m3uSource, renderMovies } from './test-utils';

const views: PlayerViewProps[] = [];
vi.mock('@/player/ui', () => ({
  PlayerView: (props: PlayerViewProps) => {
    views.push(props);
    return <div role="region" aria-label={`Player: ${props.title}`} />;
  },
}));

const SOURCE = 'p1';
const LABEL = t.state.protectedContent.label;
/** A card whose name is the title followed by the protected-content label. */
const named = (title: string) => (name: string) =>
  name.startsWith(title) && name.replace(/\s+/g, ' ').includes(LABEL);

beforeAll(async () => {
  await sourcesRepo.put(m3uSource(SOURCE, 'List', 1));
  await catalogRepo.replaceForSource(SOURCE, 'movie', {
    categories: [
      { externalId: '1', name: 'Mixed' },
      { externalId: '2', name: 'Locked' },
    ],
    items: [
      {
        externalId: 'free',
        categoryExternalId: '1',
        name: 'Free Film',
        streamPath: '',
        streamUrl: 'https://cdn.example.test/free.mp4',
        container: 'mp4',
      },
      {
        externalId: 'drm',
        categoryExternalId: '1',
        name: 'DRM Film',
        streamPath: '',
        streamUrl: 'https://cdn.example.test/drm.mpd',
        container: 'dash',
        drm: true,
      },
      {
        externalId: 'dash',
        categoryExternalId: '2',
        name: 'DASH Film',
        streamPath: '',
        streamUrl: 'https://cdn.example.test/dash.mpd',
        container: 'dash',
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
beforeEach(() => {
  restoreScroll = installScrollMetrics();
  views.length = 0;
});
afterEach(async () => {
  cleanup();
  restoreScroll();
  media?.restore();
  media = undefined;
  forgetActiveSource();
  clearProjectionCache();
  clearBrowseState();
  await settingsRepo.set('hideProtectedContent', false);
});

function show(path: string) {
  const view = renderMovies(path);
  media = view.media;
  return view;
}

const grid = (name: string) => screen.findByRole('grid', { name }, { timeout: 5000 });

describe('UX-07 — Movies grid', () => {
  it('marks protected movies with the badge and an accessible label', async () => {
    show('/movies');
    const g = await grid('Movies in All');
    const drm = await within(g).findByRole('link', { name: named('DRM Film') });
    expect(within(drm).getByTestId('protected-badge')).toBeVisible();
    expect(within(g).getByRole('link', { name: named('DASH Film') })).toBeInTheDocument();
    const free = within(g).getByRole('link', { name: 'Free Film' });
    expect(within(free).queryByTestId('protected-badge')).toBeNull();
    expect(within(g).getAllByRole('gridcell')).toHaveLength(3);
  });

  it('"Hide protected content" leaves them out; an all-protected category says why it is empty', async () => {
    await settingsRepo.set('hideProtectedContent', true);
    show('/movies');
    const g = await grid('Movies in All');
    await within(g).findByRole('link', { name: 'Free Film' });
    expect(within(g).getAllByRole('gridcell')).toHaveLength(1);
    expect(screen.queryByText('DRM Film')).toBeNull();
    cleanup();
    clearProjectionCache();

    show('/movies/category/2');
    expect(await screen.findByText(t.movies.emptyCategory.title)).toBeInTheDocument();
    expect(screen.getByText(t.state.protectedContent.allHidden)).toBeInTheDocument();
  });
});

describe('UX-07 — Movie details', () => {
  it('a protected movie: badge in the hero, Play disabled with the reason, never played', async () => {
    show('/movies/drm');
    const play = await screen.findByRole('button', { name: t.movies.details.play });
    expect(play).toBeDisabled();
    const note = screen.getByText(t.state.protectedContent.unplayable);
    expect(play).toHaveAttribute('aria-describedby', note.id);
    expect(screen.getByRole('img', { name: LABEL })).toBeInTheDocument();
    await userEvent.click(play).catch(() => undefined);
    expect(views).toHaveLength(0);
    expect(screen.queryByRole('region', { name: /Player/ })).toBeNull();
  });

  it('a playable movie has no badge and plays', async () => {
    show('/movies/free');
    const play = await screen.findByRole('button', { name: t.movies.details.play });
    expect(play).toBeEnabled();
    expect(screen.queryByRole('img', { name: LABEL })).toBeNull();
    await userEvent.click(play);
    expect(await screen.findByRole('region', { name: 'Player: Free Film' })).toBeInTheDocument();
  });
});
