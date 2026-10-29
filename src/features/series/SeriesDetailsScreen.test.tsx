// SER-02 (details, seasons, episodes, progress, both episode shapes) and SER-03 (play an episode,
// resume rules, saving, next episode across seasons, nothing after the last one), with the MSW
// Xtream panel and fake-indexeddb. The player UI is mocked: it renders its overlay and hands a
// controllable fake <video> to the screen.
import 'fake-indexeddb/auto';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useEffect, useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import {
  catalogRepo,
  episodeItemKey,
  historyRepo,
  itemKey,
  settingsRepo,
  sourcesRepo,
  wipeAll,
  type Source,
} from '@/core/db';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import { forgetActiveSource } from '@/core/session';
import type { PlayerViewProps } from '@/player/ui';
import { mapSeries } from '@/providers/xtream';
import {
  XTREAM_TEST_BASE_URL,
  XTREAM_TEST_CREDENTIALS,
  xtreamFixtures,
  xtreamHandlers,
} from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { sourceIdentity } from '@/ui/vod/resolveVod';
import { seriesBrowse } from './browseState';
import { m3uSource, renderSeries } from './test-utils';

// --- player mock ----------------------------------------------------------------------------------
interface FakeVideo {
  video: HTMLVideoElement;
  /** Plays to `time` of `duration` (fires `timeupdate`). */
  at(time: number, duration?: number): void;
  pause(): void;
}

function makeVideo(): FakeVideo {
  const video = document.createElement('video');
  const s = { time: 0, duration: Number.NaN, paused: false };
  const define = (name: string, get: () => unknown) =>
    Object.defineProperty(video, name, { configurable: true, get });
  define('currentTime', () => s.time);
  define('duration', () => s.duration);
  define('paused', () => s.paused);
  define('ended', () => false);
  return {
    video,
    at(time, duration = s.duration) {
      act(() => {
        s.time = time;
        s.duration = duration;
        s.paused = false;
        video.dispatchEvent(new Event('timeupdate'));
      });
    },
    pause() {
      act(() => {
        s.paused = true;
        video.dispatchEvent(new Event('pause'));
      });
    },
  };
}

const views: PlayerViewProps[] = [];
let currentVideo: FakeVideo | undefined;
vi.mock('@/player/ui', () => ({
  PlayerView: function MockPlayerView(props: PlayerViewProps) {
    views.push(props);
    const [fake] = useState(makeVideo);
    const { onVideoElement } = props;
    useEffect(() => {
      currentVideo = fake;
      onVideoElement?.(fake.video);
      return () => onVideoElement?.(null);
    }, [fake, onVideoElement]);
    return (
      <div role="region" aria-label={`Player: ${props.title}`}>
        {props.overlay}
      </div>
    );
  },
}));
const lastView = () => {
  const view = views.at(-1);
  if (!view) throw new Error('no PlayerView rendered');
  return view;
};
/** Lets the screen attach its listeners to the player's video. */
async function attached() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}
const video = () => {
  if (!currentVideo) throw new Error('no video');
  return currentVideo;
};

// --- data -----------------------------------------------------------------------------------------
const requests: URL[] = [];
const server = createMswServer(...xtreamHandlers());
server.events.on('request:start', ({ request }) => {
  requests.push(new URL(request.url));
});
const infoRequests = () =>
  requests.filter((u) => u.searchParams.get('action') === 'get_series_info');

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
  lastSyncAt: 100,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};
const seriesKey = (id: string) => itemKey(XTREAM, 'series', id);
const epKey = (series: string, ep: string) => episodeItemKey(seriesKey(series), ep);

beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  await sourcesRepo.put(xtream);
  await sourcesRepo.put(m3uSource(M3U, 'M3U list', 2));
  await credentialVault.put('xtream:x1', PASS);
  await catalogRepo.replaceForSource(XTREAM, 'series', {
    categories: [
      { externalId: '20', name: 'Drama' },
      { externalId: '21', name: 'Animação' },
    ],
    items: mapSeries(xtreamFixtures.variants.A.series).items,
  });
  await catalogRepo.replaceForSource(M3U, 'series', {
    categories: [{ externalId: 'g', name: 'Shows' }],
    items: [
      {
        externalId: 'm-1',
        categoryExternalId: 'g',
        name: 'Local Show S02E03',
        streamUrl: 'https://cdn.example.test/series/local-s02e03.mkv',
      },
    ],
  });
}, 30_000);

afterEach(async () => {
  server.resetHandlers();
  requests.length = 0;
  views.length = 0;
  currentVideo = undefined;
  media?.restore();
  media = undefined;
  seriesBrowse.clear();
  clearLogBuffer();
  forgetActiveSource();
  vi.restoreAllMocks();
  await settingsRepo.set('activeSourceId', XTREAM);
});

afterAll(async () => {
  server.close();
  await wipeAll();
});

let media: { restore(): void } | undefined;
async function open(path: string, sourceId = XTREAM) {
  await settingsRepo.set('activeSourceId', sourceId);
  const view = renderSeries(path);
  media = view.media;
  await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
  return view;
}
async function clearSeries(id: string) {
  const key = seriesKey(id);
  const all = await historyRepo.listRecent(XTREAM, 'series', 1000);
  for (const e of all) if (e.itemKey.startsWith(key)) await historyRepo.remove(e.itemKey);
  await catalogRepo.putSeriesDetails({
    seriesKey: key,
    sourceId: XTREAM,
    fetchedAt: 0,
    seasons: [],
  });
}
const episodes = () => screen.getAllByTestId('episode-row');
const playRow = (i: number) => within(episodes()[i] as HTMLElement).getByRole('button');
const rowTexts = () => episodes().map((r) => r.textContent);

// --- SER-02 ----------------------------------------------------------------------------------------
describe('SeriesDetailsScreen — details (SER-02 AC1, AC5)', () => {
  it('episodes by season (object shape): requests get_series_info, seasons in order, episodes by number', async () => {
    await clearSeries('3001');
    await open('/series/3001');
    expect(screen.getByRole('heading', { level: 1, name: 'Example Drama' })).toBeInTheDocument();
    const tabs = await screen.findByRole('tablist', { name: 'Seasons' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Season 1', 'Season 2']);
    expect(infoRequests()).toHaveLength(1);
    expect(infoRequests()[0]?.searchParams.get('series_id')).toBe('3001');
    expect(screen.getByRole('list', { name: 'Episodes of Season 1' })).toBeInTheDocument();
    expect(rowTexts()).toEqual(['E01 · Episódio 1', 'E02 · Episódio 2']);
    // Meta from get_series_info: year · seasons · genre, rating; cast/director.
    expect(screen.getByTestId('series-meta')).toHaveTextContent('2024·2 seasons·Drama·8.2');
    expect(screen.getByText('Rating 8.2 out of 10')).toBeInTheDocument();
    expect(screen.getByText('Carol Placeholder')).toBeInTheDocument();
    expect(screen.getByTestId('series-backdrop')).toHaveAttribute(
      'src',
      'http://img.example.test/backdrops/3001.jpg',
    );
    // Cached with the source identity.
    const cached = await catalogRepo.getSeriesDetails(seriesKey('3001'));
    expect(cached?.identity).toBe(sourceIdentity(xtream));
    expect(cached?.seasons.map((s) => s.episodes.length)).toEqual([2, 1]);
    expect(cached?.seasons[0]?.episodes[1]?.key).toBe(epKey('3001', '40102'));
  });

  it('switching season shows its episodes', async () => {
    await open('/series/3001');
    await userEvent.click(await screen.findByRole('tab', { name: 'Season 2' }));
    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Season 2');
    expect(screen.getByRole('list', { name: 'Episodes of Season 2' })).toBeInTheDocument();
    expect(rowTexts()).toEqual(['E01 · Episódio 1']);
  });

  it('episodes as an array of seasons without season metadata: "Season N" (SER-02 AC2)', async () => {
    await open('/series/3002');
    const tabs = await screen.findByRole('tablist', { name: 'Seasons' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Season 1', 'Season 2']);
    expect(rowTexts()).toEqual(['E01 · Episódio 1', 'E02 · Episódio 2']);
  });

  it('the cached details are reused within 24 h (no second request)', async () => {
    await open('/series/3002');
    await screen.findByRole('tablist', { name: 'Seasons' });
    expect(infoRequests()).toHaveLength(0);
  });

  it('more than 6 seasons: a dropdown instead of tabs', async () => {
    await clearSeries('3003');
    const many = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [String(i + 1), [{ id: 900 + i, episode_num: 1 }]]),
    );
    server.use(
      http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, () =>
        HttpResponse.json({ info: [], seasons: [], episodes: many }),
      ),
    );
    await open('/series/3003');
    const select = await screen.findByRole('combobox', { name: 'Seasons' });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(within(select).getAllByRole('option')).toHaveLength(8);
    await userEvent.selectOptions(select, '7');
    expect(screen.getByRole('list', { name: 'Episodes of Season 7' })).toBeInTheDocument();
    await clearSeries('3003');
  });

  it('specials (season 0) come last and are not the default season (review #5)', async () => {
    await clearSeries('3003');
    server.use(
      http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, () =>
        HttpResponse.json({
          info: [],
          seasons: [],
          episodes: {
            '0': [{ id: 800, episode_num: 1, title: 'Behind the scenes' }],
            '1': [{ id: 801, episode_num: 1, title: 'Pilot' }],
          },
        }),
      ),
    );
    await open('/series/3003');
    const tabs = await screen.findByRole('tablist', { name: 'Seasons' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Season 1', 'Specials']);
    expect(screen.getByRole('tab', { name: 'Season 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Play S1 E1' })).toBeInTheDocument();
    await clearSeries('3003');
  });

  it('no episodes on the server: says so; missing metadata leaves no gaps', async () => {
    await open('/series/3003');
    expect(await screen.findByRole('heading', { name: 'No episodes' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    // Only the catalogue's year and genre; no seasons, no rating (rating 0 = not rated).
    expect(screen.getByTestId('series-meta')).toHaveTextContent(/^2024·Drama$/);
    expect(screen.queryByRole('button', { name: /^Play S/ })).toBeNull();
  });

  it('a failure keeps the catalogue data and offers Retry', async () => {
    await clearSeries('3002');
    server.use(...xtreamHandlers({ error: 'http-500', errorOn: ['get_series_info'] }));
    await open('/series/3002');
    expect(
      await screen.findByRole('heading', { name: "Couldn't load the episodes" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('series-plot')).toHaveTextContent(
      'Synthetic plot for A Série de Teste.',
    );
    server.resetHandlers();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('tablist', { name: 'Seasons' })).toBeInTheDocument();
    // Nothing sensitive was logged about the failure.
    expect(JSON.stringify(getLogEntries())).not.toContain(PASS);
  });

  it('an unknown series is "not found"', async () => {
    await open('/series/999999');
    expect(screen.getByRole('heading', { level: 1, name: 'Series not found' })).toBeInTheDocument();
  });

  it('M3U: the entry is its own episode, with its S01E02 marker (SER-02 AC4)', async () => {
    await open('/series/m-1', M3U);
    const play = await screen.findByRole('button', { name: 'Play S2 E3' });
    expect(screen.getByRole('tab', { name: 'Season 2' })).toBeInTheDocument();
    await userEvent.click(play);
    await screen.findByRole('region', { name: /^Player: Local Show S02E03/ });
    expect(lastView().descriptor).toEqual({
      url: 'https://cdn.example.test/series/local-s02e03.mkv',
      kind: 'vod',
      container: 'mkv',
    });
  });
});

describe('SeriesDetailsScreen — progress (SER-02 AC3, VOD-03)', () => {
  it('episodes show watched / in progress; the series shows "Continue S1 E2" with resume', async () => {
    await clearSeries('3001');
    await historyRepo.upsert({
      itemKey: epKey('3001', '40101'),
      positionSec: 300,
      durationSec: 300,
      completed: true,
    });
    await historyRepo.upsert({
      itemKey: epKey('3001', '40102'),
      positionSec: 150,
      durationSec: 300,
    });
    await historyRepo.upsert({
      itemKey: seriesKey('3001'),
      episodeKey: epKey('3001', '40102'),
      positionSec: 150,
      durationSec: 300,
    });
    await open('/series/3001');
    const cont = await screen.findByRole('button', { name: 'Continue S1 E2' });
    expect(screen.getByTestId('series-resume-note')).toHaveTextContent('Resume at 2:30');
    const [first, second] = episodes();
    expect(within(first as HTMLElement).getByTestId('episode-watched')).toHaveTextContent(
      'Watched',
    );
    expect(within(second as HTMLElement).getByTestId('episode-progress')).toBeInTheDocument();
    expect(second).toHaveTextContent('50% watched');

    await userEvent.click(cont);
    const region = await screen.findByRole('region', { name: /^Player: Example Drama · S1 E2/ });
    expect(region).toBeInTheDocument();
    expect(lastView().startAt).toBe(150);
    expect(lastView().descriptor).toEqual({
      url: `${XTREAM_TEST_BASE_URL}/series/${USER}/${PASS}/40102.mkv`,
      kind: 'vod',
      container: 'mkv',
    });
  });

  it('"Start from the beginning" plays the same episode from 0', async () => {
    await open('/series/3001');
    await userEvent.click(await screen.findByRole('button', { name: 'Start from the beginning' }));
    await screen.findByRole('region', { name: /S1 E2/ });
    expect(lastView().startAt).toBeUndefined();
  });

  it('a finished episode moves "Continue" to the next one, across seasons', async () => {
    await clearSeries('3001');
    await historyRepo.upsert({
      itemKey: epKey('3001', '40102'),
      positionSec: 300,
      durationSec: 300,
      completed: true,
    });
    await historyRepo.upsert({ itemKey: seriesKey('3001'), episodeKey: epKey('3001', '40102') });
    await open('/series/3001');
    expect(await screen.findByRole('button', { name: 'Continue S2 E1' })).toBeInTheDocument();
    // The season of the episode to continue is selected.
    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Start from the beginning' })).toBeNull();
  });

  it('without history: "Play S1 E1"', async () => {
    await clearSeries('3002');
    await open('/series/3002');
    expect(await screen.findByRole('button', { name: 'Play S1 E1' })).toBeInTheDocument();
  });
});

// --- SER-03 ----------------------------------------------------------------------------------------
describe('SeriesDetailsScreen — playing episodes (SER-03)', () => {
  it('an episode row plays it; pausing saves the episode and the series entries', async () => {
    await clearSeries('3001');
    await open('/series/3001');
    await screen.findByRole('tablist', { name: 'Seasons' });
    await userEvent.click(playRow(0));
    await screen.findByRole('region', { name: /S1 E1 · Episódio 1/ });
    expect(lastView().descriptor.url).toBe(
      `${XTREAM_TEST_BASE_URL}/series/${USER}/${PASS}/40101.mp4`,
    );
    await attached();
    video().at(125, 1200);
    video().pause();
    await waitFor(async () =>
      expect(await historyRepo.get(epKey('3001', '40101'))).toMatchObject({
        positionSec: 125,
        durationSec: 1200,
        completed: false,
      }),
    );
    expect(await historyRepo.get(seriesKey('3001'))).toMatchObject({
      episodeKey: epKey('3001', '40101'),
      positionSec: 125,
      completed: false,
    });
    // The list follows the saved progress.
    await waitFor(() => expect(episodes()[0]).toHaveTextContent('10% watched'));
    // The password never reaches the logs.
    expect(JSON.stringify(getLogEntries())).not.toContain(PASS);
  });

  it('"Next episode in 10 s" at ≤ 20 s remaining; Play now crosses into the next season', async () => {
    await clearSeries('3001');
    await open('/series/3001');
    await screen.findByRole('tablist', { name: 'Seasons' });
    await userEvent.click(playRow(1));
    await screen.findByRole('region', { name: /S1 E2/ });
    await attached();
    video().at(1000, 1200);
    expect(screen.queryByTestId('next-episode-card')).toBeNull();
    video().at(1185, 1200);
    const card = await screen.findByTestId('next-episode-card');
    expect(card).toHaveTextContent('Next episode in 10 s');
    expect(card).toHaveTextContent('S2 E1 · Episódio 1');
    await userEvent.click(within(card).getByRole('button', { name: 'Play now' }));
    await screen.findByRole('region', { name: /S2 E1/ });
    expect(lastView().descriptor.url).toBe(
      `${XTREAM_TEST_BASE_URL}/series/${USER}/${PASS}/40201.mp4`,
    );
    expect(lastView().startAt).toBeUndefined();
    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveAttribute('aria-selected', 'true');
    // The episode left early still counts as watched.
    await waitFor(async () =>
      expect((await historyRepo.get(epKey('3001', '40102')))?.completed).toBe(true),
    );
  });

  it('paused, then Play now: the episode is still saved as watched (review #3/#8)', async () => {
    await clearSeries('3001');
    await open('/series/3001');
    await screen.findByRole('tablist', { name: 'Seasons' });
    await userEvent.click(playRow(1));
    await screen.findByRole('region', { name: /S1 E2/ });
    await attached();
    // 285 / 300 = 95 %: not yet "watched", but within the last 20 s.
    video().at(285, 300);
    video().pause();
    await waitFor(async () =>
      expect(await historyRepo.get(epKey('3001', '40102'))).toMatchObject({
        positionSec: 285,
        completed: false,
      }),
    );
    const card = await screen.findByTestId('next-episode-card');
    await userEvent.click(within(card).getByRole('button', { name: 'Play now' }));
    await screen.findByRole('region', { name: /S2 E1/ });
    await waitFor(async () =>
      expect(await historyRepo.get(epKey('3001', '40102'))).toMatchObject({ completed: true }),
    );
    // The series now points at the next episode, from the start (Home "Continue watching").
    await waitFor(async () =>
      expect(await historyRepo.get(seriesKey('3001'))).toMatchObject({
        episodeKey: epKey('3001', '40201'),
        positionSec: 0,
        completed: false,
      }),
    );
    act(() => lastView().onClose?.());
    expect(await screen.findByRole('button', { name: 'Continue S2 E1' })).toBeInTheDocument();
  });

  it('Cancel hides the card and stays on the episode', async () => {
    await open('/series/3001');
    await screen.findByRole('tablist', { name: 'Seasons' });
    await userEvent.click(screen.getByRole('tab', { name: 'Season 1' }));
    await userEvent.click(playRow(0));
    await screen.findByRole('region', { name: /S1 E1/ });
    await attached();
    video().at(1190, 1200);
    const card = await screen.findByTestId('next-episode-card');
    await userEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('next-episode-card')).toBeNull();
    video().at(1195, 1200);
    expect(screen.queryByTestId('next-episode-card')).toBeNull();
    expect(screen.getByRole('region', { name: /S1 E1/ })).toBeInTheDocument();
  });

  it('the last episode offers nothing (SER-03 AC3); closing the player saves it', async () => {
    await clearSeries('3001');
    await open('/series/3001');
    await userEvent.click(await screen.findByRole('tab', { name: 'Season 2' }));
    await userEvent.click(playRow(0));
    await screen.findByRole('region', { name: /S2 E1/ });
    await attached();
    video().at(1195, 1200);
    expect(screen.queryByTestId('next-episode-card')).toBeNull();
    act(() => lastView().onClose?.());
    await waitFor(() => expect(screen.queryByRole('region', { name: /^Player/ })).toBeNull());
    // 1195 / 1200 > 95 %: watched; the last episode completes the series entry.
    await waitFor(async () =>
      expect(await historyRepo.get(seriesKey('3001'))).toMatchObject({
        episodeKey: epKey('3001', '40201'),
        completed: true,
      }),
    );
    expect(await historyRepo.get(epKey('3001', '40201'))).toMatchObject({ completed: true });
  });
});
