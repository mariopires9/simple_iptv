// PLY-08: "Open in VLC" in the player — the in-app stream is stopped before the hand-off, the
// DIRECT address is handed off (not the personal-proxy one), the error overlay offers it too, iOS
// warns when VLC did not open, and the stored setting / platform default decide whether it shows.
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsRepo, wipeAll } from '@/core/db';
import { clearLogBuffer, getLogEntries, toLogJson } from '@/core/log';
import { vlcIosLink } from '../external';
import type { HandoffEnv } from '../external/handoff';
import { PlaybackError, type StreamDescriptor } from '../types';
import { VLC_OPEN_CHECK_MS } from './PlayerView';
import { flush, renderPlayer } from './test-utils/renderPlayer';
import { resetShowOpenInVlcSettingForTests } from './useShowOpenInVlcSetting';

// Synthetic credentials only.
const DIRECT_TS = 'http://xtream.example/live/demo/synthetic-pass/1001.ts';
const LIVE_HLS: StreamDescriptor = {
  url: 'http://xtream.example/live/demo/synthetic-pass/1001.m3u8',
  kind: 'live',
  container: 'hls',
  externalUrl: DIRECT_TS,
};
const proxy = {
  rewrite: (url: string, purpose: string) =>
    `https://proxy.example/${purpose}?u=${encodeURIComponent(url)}`,
};

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  resetShowOpenInVlcSettingForTests();
  await wipeAll();
});

const OPEN = { name: 'Open in VLC' };

/** Lets the stored settings' reads (IndexedDB) settle. */
const settle = async () => {
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  await flush();
};

function setup(platform: HandoffEnv['platform'], extra: Record<string, unknown> = {}) {
  const order: string[] = [];
  const navigate = vi.fn((href: string) => order.push(`navigate:${href}`));
  const download = vi.fn<HandoffEnv['download']>(() => order.push('download'));
  const player = renderPlayer(
    {
      descriptor: LIVE_HLS,
      rewriter: proxy,
      showOpenInVlc: true,
      handoff: { platform, navigate, download },
      ...extra,
    },
    { router: true },
  );
  player.controller.stop.mockImplementation(async () => {
    order.push('stop');
  });
  return { ...player, order, navigate, download };
}

describe('PlayerView — Open in VLC', () => {
  it('stops the in-app player, then hands the direct (not proxied) .ts URL to VLC', async () => {
    clearLogBuffer();
    const { order, navigate, controller } = setup('ios');
    await flush();
    fireEvent.click(screen.getByRole('button', OPEN));
    expect(order).toEqual(['stop', `navigate:${vlcIosLink(DIRECT_TS)}`]);
    expect(navigate.mock.calls[0]?.[0]).not.toContain('proxy.example');
    expect(controller.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('player-vlc-handoff')).toHaveTextContent(
      'Opening in VLC. The player here is stopped.',
    );
    // The address (with its credentials) is never logged.
    expect(toLogJson(getLogEntries())).not.toContain('synthetic-pass');
  });

  it('"Play here" loads the stream again in the app', async () => {
    const { controller } = setup('android');
    await flush();
    fireEvent.click(screen.getByRole('button', OPEN));
    expect(controller.play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Play here' }));
    await flush();
    expect(controller.play).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('player-vlc-handoff')).toBeNull();
  });

  it('iOS: says VLC did not open when the page is still visible after the check delay', async () => {
    setup('ios');
    await settle();
    // Only now: IndexedDB (the player's other stored settings) runs on real timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(screen.getByRole('button', OPEN));
    act(() => vi.advanceTimersByTime(VLC_OPEN_CHECK_MS));
    expect(screen.getByTestId('player-vlc-handoff')).toHaveTextContent(
      "VLC didn't open — install VLC from the App Store",
    );
  });

  it('iOS: no warning once the page went to the background (VLC opened)', async () => {
    setup('ios');
    await settle();
    // Only now: IndexedDB (the player's other stored settings) runs on real timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(screen.getByRole('button', OPEN));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
      vi.advanceTimersByTime(VLC_OPEN_CHECK_MS);
    });
    expect(screen.getByTestId('player-vlc-handoff')).not.toHaveTextContent("VLC didn't open");
  });

  it('desktop: downloads the playlist and warns that it contains the password', async () => {
    const { order, download } = setup('desktop');
    await flush();
    fireEvent.click(screen.getByRole('button', OPEN));
    expect(order).toEqual(['stop', 'download']);
    const [blob, name] = download.mock.calls[0] ?? [];
    expect(name).toBe('Channel.m3u');
    expect(await blob?.text()).toContain(DIRECT_TS);
    expect(screen.getByTestId('player-vlc-handoff')).toHaveTextContent(
      "It contains your list password; don't share it.",
    );
  });

  it('the playback error overlay offers it too', async () => {
    const { controller, order } = setup('android');
    await flush();
    act(() =>
      controller.emit(
        'error',
        new PlaybackError({ kind: 'unsupported-codec', engine: 'native', detail: 'x' }),
      ),
    );
    const overlay = await screen.findByTestId('player-error');
    fireEvent.click(
      Array.from(overlay.querySelectorAll('button')).find(
        (b) => b.textContent === 'Open in VLC',
      ) as HTMLButtonElement,
    );
    expect(order[0]).toBe('stop');
    expect(order[1]).toMatch(/^navigate:intent:\/\/xtream\.example\/live\/.*1001\.ts#Intent;/);
  });

  it('hidden when the prop is off', async () => {
    setup('ios', { showOpenInVlc: false });
    await flush();
    expect(screen.queryByRole('button', OPEN)).toBeNull();
  });
});

describe('PlayerView — "Show Open in VLC" setting (AC6)', () => {
  const render = (platform: HandoffEnv['platform']) =>
    renderPlayer(
      { descriptor: LIVE_HLS, handoff: { platform, navigate: vi.fn(), download: vi.fn() } },
      { router: true },
    );

  it('never set: on for iOS/Android, off on desktop', async () => {
    render('ios');
    await settle();
    expect(screen.getByRole('button', OPEN)).toBeInTheDocument();
    cleanup();
    render('desktop');
    await settle();
    expect(screen.queryByRole('button', OPEN)).toBeNull();
  });

  it('the stored value wins over the platform default', async () => {
    await settingsRepo.set('showOpenInVlc', true);
    render('desktop');
    await settle();
    expect(screen.getByRole('button', OPEN)).toBeInTheDocument();
    cleanup();
    resetShowOpenInVlcSettingForTests();
    await settingsRepo.set('showOpenInVlc', false);
    render('android');
    await settle();
    expect(screen.queryByRole('button', OPEN)).toBeNull();
  });
});
