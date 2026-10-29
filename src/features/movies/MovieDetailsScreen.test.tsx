import 'fake-indexeddb/auto';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import {
  catalogRepo,
  favoritesRepo,
  historyRepo,
  itemKey,
  settingsRepo,
  sourcesRepo,
  wipeAll,
  type Source,
} from '@/core/db';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import { forgetActiveSource, setActiveSource } from '@/core/session';
import type { PlayerViewProps } from '@/player/ui';
import {
  XTREAM_TEST_BASE_URL,
  XTREAM_TEST_CREDENTIALS,
  xtreamFixtures,
  xtreamHandlers,
} from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { clearInfoCache } from './movieInfo';
import { m3uSource, renderMovies } from './test-utils';

const views: PlayerViewProps[] = [];
vi.mock('@/player/ui', () => ({
  PlayerView: (props: PlayerViewProps) => {
    views.push(props);
    return <div role="region" aria-label={`Player: ${props.title}`} />;
  },
}));
const lastView = () => {
  const view = views.at(-1);
  if (!view) throw new Error('no PlayerView rendered');
  return view;
};

const requests: URL[] = [];
const server = createMswServer(...xtreamHandlers());
server.events.on('request:start', ({ request }) => {
  requests.push(new URL(request.url));
});

// Synthetic credentials only (the MSW panel's).
const { username: USER, password: PASS } = XTREAM_TEST_CREDENTIALS;
const XTREAM = 'x1';
const M3U = 'm1';

const xtream: Source = {
  id: XTREAM,
  kind: 'xtream',
  name: 'Xtream list',
  serverUrl: XTREAM_TEST_BASE_URL,
  username: USER,
  secretRef: 'xtream:x1',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};

const HTML_PLOT = '<img src=x onerror="alert(1)"><b>Bold</b> & plain';
const LONG_PLOT = 'A very long synopsis. '.repeat(30).trim();

beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  await sourcesRepo.put(xtream);
  await sourcesRepo.put(m3uSource(M3U, 'M3U list', 2));
  await credentialVault.put('xtream:x1', PASS);
  await catalogRepo.replaceForSource(XTREAM, 'movie', {
    categories: [{ externalId: '10', name: 'Movies' }],
    items: [
      {
        externalId: '2001',
        categoryExternalId: '10',
        name: 'The Synthetic Movie (2024)',
        poster: 'http://img.example.test/posters/2001.jpg',
        rating: 7.1,
        ext: 'mp4',
        streamPath: '2001.mp4',
      },
      {
        externalId: '2002',
        categoryExternalId: '10',
        name: 'Test Pattern Returns',
        streamPath: '2002.mkv',
      },
    ],
  });
  await catalogRepo.replaceForSource(M3U, 'movie', {
    categories: [{ externalId: '1', name: 'Films' }],
    items: [
      {
        externalId: 'film-1',
        categoryExternalId: '1',
        name: 'Markup Movie',
        year: 2011,
        genre: 'Drama',
        plot: HTML_PLOT,
        streamPath: '',
        streamUrl: 'https://cdn.example.test/vod/film-1.mkv',
      },
      {
        externalId: 'film-2',
        categoryExternalId: '1',
        name: 'Long Movie',
        plot: LONG_PLOT,
        streamPath: '',
        streamUrl: 'https://cdn.example.test/vod/film-2.m3u8',
      },
    ],
  });
}, 30_000);

afterEach(async () => {
  server.resetHandlers();
  requests.length = 0;
  views.length = 0;
  media?.restore();
  media = undefined;
  clearInfoCache();
  clearLogBuffer();
  forgetActiveSource();
  await settingsRepo.set('activeSourceId', XTREAM);
});

afterAll(async () => {
  server.close();
  await wipeAll();
});

let media: { restore(): void } | undefined;
async function open(path: string, sourceId = XTREAM) {
  await settingsRepo.set('activeSourceId', sourceId);
  const view = renderMovies(path);
  media = view.media;
  await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
  return view;
}

const infoRequests = () => requests.filter((u) => u.searchParams.get('action') === 'get_vod_info');

describe('MovieDetailsScreen — Xtream details (VOD-02 AC1)', () => {
  it('requests get_vod_info and shows the available fields', async () => {
    await open('/movies/2001');
    expect(
      screen.getByRole('heading', { level: 1, name: 'The Synthetic Movie (2024)' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Carol Placeholder')).toBeInTheDocument();
    expect(infoRequests()).toHaveLength(1);
    expect(infoRequests()[0]?.searchParams.get('vod_id')).toBe('2001');
    const meta = screen.getByTestId('movie-meta');
    expect(meta).toHaveTextContent('2024');
    expect(meta).toHaveTextContent('Action, Comédia');
    expect(within(meta).getByText('Rating 7.1 out of 10')).toBeInTheDocument();
    expect(screen.getByText('Alice Example, Bob Sample, João Exemplo')).toBeInTheDocument();
    expect(screen.getByTestId('movie-plot')).toHaveTextContent(xtreamFixtures.vodInfo.info.plot);
    expect(screen.getByTestId('movie-backdrop')).toHaveAttribute(
      'src',
      'http://img.example.test/backdrops/2001.jpg',
    );
    expect(screen.getByTestId('movie-backdrop')).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.queryByText(/Couldn't load more details/)).toBeNull();
  });

  it('shows the running time and caches the details (no second request within 24 h)', async () => {
    server.use(
      http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, () =>
        HttpResponse.json({
          info: { ...xtreamFixtures.vodInfo.info, duration_secs: 6125 },
          movie_data: xtreamFixtures.vodInfo.movie_data,
        }),
      ),
    );
    const first = await open('/movies/2001');
    expect(await screen.findByText('1 h 42 min')).toBeInTheDocument();
    first.unmount();
    media?.restore();
    await open('/movies/2001');
    expect(await screen.findByText('1 h 42 min')).toBeInTheDocument();
    expect(infoRequests()).toHaveLength(1);
  });

  it('partial details: only the fields that exist, no empty labels or separators', async () => {
    await open('/movies/2002');
    await waitFor(() => expect(infoRequests()).toHaveLength(1));
    // Nothing known beyond the title: no metadata line, synopsis, director or cast.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled());
    expect(screen.queryByTestId('movie-meta')).toBeNull();
    expect(screen.queryByTestId('movie-plot')).toBeNull();
    expect(screen.queryByText('Director')).toBeNull();
    expect(screen.queryByText('Cast')).toBeNull();
    expect(screen.queryByText(/Couldn't load more details/)).toBeNull();
  });
});

describe('MovieDetailsScreen — get_vod_info failure (VOD-02 AC4)', () => {
  it('shows the list data and still plays', async () => {
    server.use(...xtreamHandlers({ error: 'http-500' }));
    await open('/movies/2001');
    expect(await screen.findByText(/Couldn't load more details/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId('movie-meta')).getByText('Rating 7.1 out of 10'),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await screen.findByRole('region', { name: 'Player: The Synthetic Movie (2024)' });
    expect(lastView().descriptor).toEqual({
      url: `${XTREAM_TEST_BASE_URL}/movie/${USER}/${PASS}/2001.mp4`,
      kind: 'vod',
      container: 'mp4',
    });
  });
});

describe('MovieDetailsScreen — server text is text (VOD-02 AC2)', () => {
  it('markup in the synopsis is shown literally, never parsed', async () => {
    await open('/movies/film-1', M3U);
    const plot = screen.getByTestId('movie-plot');
    expect(plot).toHaveTextContent(HTML_PLOT);
    expect(plot.querySelector('img, b')).toBeNull();
    expect(screen.getByTestId('movie-meta')).toHaveTextContent('2011');
    expect(screen.getByTestId('movie-meta')).toHaveTextContent('Drama');
    // M3U sources have no details endpoint.
    expect(requests).toHaveLength(0);
  });

  it('a long synopsis is clamped with "More"/"Less"', async () => {
    await open('/movies/film-2', M3U);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveAttribute('aria-controls', screen.getByTestId('movie-plot').id);
    await userEvent.click(more);
    expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('MovieDetailsScreen — Play / Resume (VOD-02 AC3)', () => {
  it('Xtream: Play opens the player with the in-memory URL and no start position', async () => {
    await open('/movies/2001');
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await screen.findByRole('region', { name: 'Player: The Synthetic Movie (2024)' });
    expect(lastView()).toMatchObject({
      title: 'The Synthetic Movie (2024)',
      kind: 'vod',
      descriptor: {
        url: `${XTREAM_TEST_BASE_URL}/movie/${USER}/${PASS}/2001.mp4`,
        kind: 'vod',
        container: 'mp4',
      },
    });
    expect(lastView().startAt).toBeUndefined();
    // Esc / back closes it and returns focus to the button.
    act(() => lastView().onClose?.());
    await waitFor(() => expect(screen.queryByRole('region', { name: /^Player/ })).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus());
  });

  it('with a saved position: "Resume at mm:ss" passes startAt', async () => {
    const key = itemKey(XTREAM, 'movie', '2002');
    await historyRepo.upsert({ itemKey: key, positionSec: 754, durationSec: 5400 });
    try {
      await open('/movies/2002');
      await userEvent.click(await screen.findByRole('button', { name: 'Resume at 12:34' }));
      await screen.findByRole('region', { name: 'Player: Test Pattern Returns' });
      expect(lastView().startAt).toBe(754);
      expect(lastView().descriptor).toEqual({
        url: `${XTREAM_TEST_BASE_URL}/movie/${USER}/${PASS}/2002.mkv`,
        kind: 'vod',
        container: 'mkv',
      });
    } finally {
      await historyRepo.remove(key);
    }
  });

  it('a finished movie plays from the start', async () => {
    const key = itemKey(XTREAM, 'movie', '2002');
    await historyRepo.upsert({ itemKey: key, positionSec: 5390, completed: true });
    try {
      await open('/movies/2002');
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    } finally {
      await historyRepo.remove(key);
    }
  });

  it('M3U: plays the entry URL with its container', async () => {
    await open('/movies/film-2', M3U);
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await screen.findByRole('region', { name: 'Player: Long Movie' });
    expect(lastView().descriptor).toEqual({
      url: 'https://cdn.example.test/vod/film-2.m3u8',
      kind: 'vod',
      container: 'hls',
    });
  });

  it('never writes the password or the stream URL to the log', async () => {
    server.use(...xtreamHandlers({ error: 'http-500' }));
    await open('/movies/2001');
    await screen.findByText(/Couldn't load more details/);
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await screen.findByRole('region', { name: /^Player/ });
    const dump = JSON.stringify(getLogEntries());
    expect(getLogEntries().length).toBeGreaterThan(0);
    expect(dump).not.toContain(PASS);
    expect(dump).not.toContain('/movie/');
  });
});

describe('MovieDetailsScreen — favourite, states and active list', () => {
  it('★ toggles the favourite (aria-pressed) and persists it', async () => {
    await open('/movies/film-1', M3U);
    const key = itemKey(M3U, 'movie', 'film-1');
    const add = screen.getByRole('button', { name: 'Add to favorites' });
    expect(add).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(add);
    expect(screen.getByRole('button', { name: 'Remove from favorites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(async () => expect(await favoritesRepo.has(key)).toBe(true));
    expect(screen.getByRole('status')).toHaveTextContent('Markup Movie added to favorites');
    await userEvent.click(screen.getByRole('button', { name: 'Remove from favorites' }));
    await waitFor(async () => expect(await favoritesRepo.has(key)).toBe(false));
  });

  it('an unknown movie shows "Movie not found" and a way back', async () => {
    await open('/movies/9999');
    expect(screen.getByRole('heading', { name: 'Movie not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to movies' })).toHaveAttribute('href', '/movies');
  });

  it('switching the active list leaves the previous list’s movie', async () => {
    const { router } = await open('/movies/2001');
    await screen.findByText('Carol Placeholder');
    await act(() => setActiveSource(M3U));
    await waitFor(() => expect(router.state.location.pathname).toBe('/movies'));
  });
});
