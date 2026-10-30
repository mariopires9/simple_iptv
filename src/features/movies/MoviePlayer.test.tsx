// Review #1: the stream is resolved once per Play press; details that arrive late never reload.
import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import { wipeAll, type Movie, type Source } from '@/core/db';
import { removePersonalProxy, savePersonalProxy } from '@/core/session';
import type { PlayerViewProps } from '@/player/ui';
import { ThemeModeProvider } from '@/ui/theme';
import { MoviePlayer } from './MoviePlayer';

const views: PlayerViewProps[] = [];
vi.mock('@/player/ui', () => ({
  PlayerView: (props: PlayerViewProps) => {
    views.push(props);
    return <div role="region" aria-label={`Player: ${props.title}`} />;
  },
}));

// Synthetic credentials only.
const PASS = 'synthetic-pass';
const source: Source = {
  id: 'x1',
  kind: 'xtream',
  name: 'Xtream',
  serverUrl: 'http://panel.example.test:8080',
  username: 'demo',
  secretRef: 'xtream:player-test',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};
const movie = (streamPath: string): Movie => ({
  key: 'x1:movie:7',
  sourceId: 'x1',
  type: 'movie',
  externalId: '7',
  name: 'Seven',
  order: 0,
  streamPath,
});

beforeAll(async () => {
  await credentialVault.put('xtream:player-test', PASS);
});
afterAll(async () => {
  await wipeAll();
});
beforeEach(() => {
  views.length = 0;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function show(
  m: Movie,
  getInfoExt: () => Promise<string | undefined>,
  infoWaitMs?: number,
  list: Source = source,
) {
  return render(
    <ThemeModeProvider>
      <MemoryRouter>
        <MoviePlayer
          source={list}
          movie={m}
          startAt={undefined}
          getInfoExt={getInfoExt}
          {...(infoWaitMs !== undefined ? { infoWaitMs } : {})}
          onClose={() => {}}
        />
      </MemoryRouter>
    </ThemeModeProvider>,
  );
}

const urls = () => [...new Set(views.map((v) => v.descriptor.url))];

describe('MoviePlayer', () => {
  it('no extension in the catalogue: waits for the details and uses their extension', async () => {
    const info = deferred<string | undefined>();
    show(movie('7'), () => info.promise);
    await new Promise((r) => setTimeout(r, 20));
    expect(views).toHaveLength(0);
    expect(screen.getByTestId('player-pending')).toBeInTheDocument();
    await act(async () => info.resolve('avi'));
    await screen.findByRole('region', { name: 'Player: Seven' });
    expect(urls()).toEqual([`http://panel.example.test:8080/movie/demo/${PASS}/7.avi`]);
    expect(views.at(-1)?.descriptor.container).toBe('avi');
  });

  it('slow details: falls back to mp4 after the wait and never reloads when they arrive', async () => {
    const info = deferred<string | undefined>();
    show(movie('7'), () => info.promise, 30);
    await screen.findByRole('region', { name: 'Player: Seven' });
    expect(urls()).toEqual([`http://panel.example.test:8080/movie/demo/${PASS}/7.mp4`]);
    await act(async () => info.resolve('mkv'));
    await new Promise((r) => setTimeout(r, 20));
    expect(urls()).toHaveLength(1);
  });

  it('with an extension in the catalogue, the details are not awaited', async () => {
    const getInfoExt = vi.fn(() => new Promise<string | undefined>(() => {}));
    show(movie('7.mkv'), getInfoExt);
    await screen.findByRole('region', { name: 'Player: Seven' });
    expect(getInfoExt).not.toHaveBeenCalled();
    expect(urls()).toEqual([`http://panel.example.test:8080/movie/demo/${PASS}/7.mkv`]);
  });

  it('a new getInfoExt (details re-render) does not resolve again', async () => {
    const bare = movie('7');
    const view = show(bare, () => Promise.resolve('avi'));
    await screen.findByRole('region', { name: 'Player: Seven' });
    const before = views.length;
    view.rerender(
      <ThemeModeProvider>
        <MemoryRouter>
          <MoviePlayer
            source={source}
            movie={bare}
            startAt={undefined}
            getInfoExt={() => Promise.resolve('mkv')}
            onClose={() => {}}
          />
        </MemoryRouter>
      </ThemeModeProvider>,
    );
    await waitFor(() => expect(views.length).toBeGreaterThan(before));
    await new Promise((r) => setTimeout(r, 20));
    expect(urls()).toEqual([`http://panel.example.test:8080/movie/demo/${PASS}/7.avi`]);
  });

  it('PRX-01: the player gets the list’s playback rewriter (proxy for `streams`, direct when off)', async () => {
    const token = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
    await savePersonalProxy({ baseUrl: 'https://pc.example.test', token });
    try {
      const routed: Source = { ...source, prefs: { liveFormat: 'auto', proxy: 'streams' } };
      const view = show(movie('7.mkv'), () => Promise.resolve(undefined), undefined, routed);
      await screen.findByRole('region', { name: 'Player: Seven' });
      const props = views.at(-1);
      const url = props?.descriptor.url ?? '';
      expect(props?.rewriter?.rewrite(url, 'stream')).toMatch(
        new RegExp(`^https://pc\\.example\\.test/v1/${token}/u/[A-Za-z0-9_-]+/7\\.mkv$`),
      );
      // Never images, nor the API (that is `all`, and the data rewriter's job).
      expect(props?.rewriter?.rewrite(url, 'api')).toBe(url);
      view.unmount();

      views.length = 0;
      show(movie('7.mkv'), () => Promise.resolve(undefined));
      await screen.findByRole('region', { name: 'Player: Seven' });
      const direct = views.at(-1);
      expect(direct?.rewriter?.rewrite(url, 'stream') ?? url).toBe(url);
    } finally {
      await removePersonalProxy();
    }
  });
});
