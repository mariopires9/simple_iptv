// VOD-03: resume buttons on the movie details and position saving while a movie plays (the player
// UI is mocked and hands a controllable fake <video> to the screen).
import 'fake-indexeddb/auto';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { catalogRepo, historyRepo, itemKey, settingsRepo, sourcesRepo, wipeAll } from '@/core/db';
import { forgetActiveSource } from '@/core/session';
import type { PlayerViewProps } from '@/player/ui';
import { clearBrowseState } from './browseState';
import { m3uSource, renderMovies } from './test-utils';

interface Fake {
  video: HTMLVideoElement;
  at(time: number, duration: number): void;
  pause(): void;
}
function makeVideo(): Fake {
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
    at(time, duration) {
      act(() => {
        Object.assign(s, { time, duration, paused: false });
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
let current: Fake | undefined;
vi.mock('@/player/ui', () => ({
  PlayerView: function MockPlayerView(props: PlayerViewProps) {
    views.push(props);
    const [fake] = useState(makeVideo);
    const { onVideoElement } = props;
    useEffect(() => {
      current = fake;
      onVideoElement?.(fake.video);
      return () => onVideoElement?.(null);
    }, [fake, onVideoElement]);
    return <div role="region" aria-label={`Player: ${props.title}`} />;
  },
}));

const SOURCE = 'm1';
const key = itemKey(SOURCE, 'movie', 'film-1');

beforeAll(async () => {
  await sourcesRepo.put(m3uSource(SOURCE, 'M3U list', 1));
  await catalogRepo.replaceForSource(SOURCE, 'movie', {
    categories: [{ externalId: '1', name: 'Films' }],
    items: [
      {
        externalId: 'film-1',
        categoryExternalId: '1',
        name: 'Resumable',
        streamPath: '',
        streamUrl: 'https://cdn.example.test/vod/film-1.mp4',
      },
    ],
  });
  await settingsRepo.set('activeSourceId', SOURCE);
});
let media: { restore(): void } | undefined;
afterEach(async () => {
  media?.restore();
  views.length = 0;
  current = undefined;
  clearBrowseState();
  forgetActiveSource();
  await historyRepo.remove(key);
});
afterAll(async () => {
  await wipeAll();
});

async function open() {
  const view = renderMovies('/movies/film-1');
  media = view.media;
  await screen.findByRole('heading', { level: 1, name: 'Resumable' });
  return view;
}
async function attached() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}
const lastView = () => views.at(-1) as PlayerViewProps;

describe('MovieDetailsScreen — resume (VOD-03 AC2)', () => {
  it('between 1 min and 95 %: "Resume at" and "Start from the beginning"', async () => {
    await historyRepo.upsert({ itemKey: key, positionSec: 754, durationSec: 5400 });
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Start from the beginning' }));
    await screen.findByRole('region', { name: 'Player: Resumable' });
    expect(lastView().startAt).toBeUndefined();
    act(() => lastView().onClose?.());
    await userEvent.click(screen.getByRole('button', { name: 'Resume at 12:34' }));
    await waitFor(() => expect(lastView().startAt).toBe(754));
  });

  it.each([
    ['below 1 min', { positionSec: 59, durationSec: 5400 }],
    ['beyond 95 %', { positionSec: 5200, durationSec: 5400 }],
    ['watched', { positionSec: 600, durationSec: 5400, completed: true }],
  ])('%s: only Play', async (_, entry) => {
    await historyRepo.upsert({ itemKey: key, ...entry });
    await open();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start from the beginning' })).toBeNull();
  });
});

describe('MovieDetailsScreen — saving the position (VOD-03 AC1/AC3)', () => {
  it('pause saves; the details follow; > 95 % marks it watched', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await screen.findByRole('region', { name: 'Player: Resumable' });
    await attached();
    current?.at(754, 5400);
    current?.pause();
    await waitFor(async () =>
      expect(await historyRepo.get(key)).toMatchObject({
        positionSec: 754,
        durationSec: 5400,
        completed: false,
      }),
    );
    await screen.findByRole('button', { name: 'Resume at 12:34' });

    current?.at(5300, 5400);
    current?.pause();
    await waitFor(async () => expect((await historyRepo.get(key))?.completed).toBe(true));
    await screen.findByRole('button', { name: 'Play' });
  });

  it('closing the player saves the last position', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await screen.findByRole('region', { name: 'Player: Resumable' });
    await attached();
    current?.at(300, 5400);
    act(() => lastView().onClose?.());
    await waitFor(async () =>
      expect(await historyRepo.get(key)).toMatchObject({ positionSec: 300, completed: false }),
    );
  });
});
