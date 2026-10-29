// Renders PlayerView with a fake controller and fake media (PLY-03/PLY-04 tests).
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { createAppTheme } from '@/ui';
import type { StreamDescriptor } from '../../types';
import { PlayerView, type PlayerViewProps } from '../PlayerView';
import { fakeController, installFakeMedia, type FakeController, type FakeMedia } from './fakeMedia';

export const VOD: StreamDescriptor = {
  url: 'https://example.test/movie.mp4',
  kind: 'vod',
  container: 'mp4',
};
export const LIVE: StreamDescriptor = {
  url: 'https://example.test/live.m3u8',
  kind: 'live',
  container: 'hls',
};
export const DESKTOP = { fullscreenApi: true, pip: true, mobile: false };
export const MOBILE = { fullscreenApi: true, pip: true, mobile: true };
export const IPHONE = { fullscreenApi: false, pip: true, mobile: true };
export const NONE = { fullscreenApi: false, pip: false, mobile: false };

const theme = createAppTheme('dark');

/** Lets pending promises (controller.play → video.play) settle inside act(). */
export async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

export const key = (target: Element, k: string) => fireEvent.keyDown(target, { key: k });

export function renderPlayer(
  props: Partial<PlayerViewProps> = {},
  options: {
    beforePlay?: (media: FakeMedia) => void;
    router?: boolean;
    /** Configures the fake controller before the first render (e.g. a failing first load). */
    onController?: (controller: FakeController) => void;
  } = {},
) {
  const controller = fakeController();
  options.onController?.(controller);
  let media: FakeMedia | undefined;
  const factory = vi.fn((video: HTMLVideoElement) => {
    media = installFakeMedia(video);
    options.beforePlay?.(media);
    return controller;
  });
  const ui = (p: Partial<PlayerViewProps>) => {
    const view = (
      <ThemeProvider theme={theme}>
        <PlayerView
          descriptor={VOD}
          title="Channel"
          createController={factory}
          platform={NONE}
          {...props}
          {...p}
        />
      </ThemeProvider>
    );
    return options.router ? <MemoryRouter>{view}</MemoryRouter> : view;
  };
  const view = render(ui({}));
  return {
    controller,
    get media() {
      if (!media) throw new Error('media not installed');
      return media;
    },
    region: () => screen.getByRole('region', { name: 'Player: Channel' }),
    rerender: (p: Partial<PlayerViewProps>) => view.rerender(ui(p)),
    unmount: view.unmount,
  };
}
