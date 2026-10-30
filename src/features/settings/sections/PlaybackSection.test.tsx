// UX-04 AC1 — Settings › Playback: fullscreen in landscape, play the last channel, preferred live
// format of the active (Xtream) list. Every change is saved where its consumer reads it.
import 'fake-indexeddb/auto';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsRepo, sourcesRepo, wipeAll, type Source } from '@/core/db';
import { forgetActiveSource } from '@/core/session';
import { t } from '@/i18n';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { renderSettings } from '../test-utils';
import { PlaybackSection } from './PlaybackSection';

const text = t.settings.playback;

const source = (id: string, kind: Source['kind'], createdAt = 1): Source => ({
  id,
  kind,
  name: `List ${id}`,
  prefs: { liveFormat: 'auto' },
  createdAt,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
});

let media: ReturnType<typeof installMatchMedia>;
beforeEach(() => {
  media = installMatchMedia({ width: 1200 });
});
afterEach(async () => {
  // Unmount first (TEC-03): the setup file's cleanup runs after this hook, and a screen still
  // mounted could re-read state while it is reset below and cache it for the next test.
  cleanup();
  vi.restoreAllMocks();
  media.restore();
  forgetActiveSource();
  await wipeAll();
});

describe('PlaybackSection (UX-04 AC1)', () => {
  it('defaults: fullscreen in landscape on, play last channel off', async () => {
    renderSettings(<PlaybackSection />);
    expect(await screen.findByRole('switch', { name: text.fullscreenOnLandscape })).toBeChecked();
    expect(screen.getByRole('switch', { name: text.playLastChannel })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: text.playLastChannel })).toHaveAccessibleDescription(
      text.playLastChannelHint,
    );
  });

  it('shows and saves both switches', async () => {
    await settingsRepo.set('fullscreenOnLandscape', false);
    await settingsRepo.set('playLastChannelOnOpen', true);
    const user = userEvent.setup();
    renderSettings(<PlaybackSection />);
    const fullscreen = await screen.findByRole('switch', { name: text.fullscreenOnLandscape });
    const playLast = screen.getByRole('switch', { name: text.playLastChannel });
    expect(fullscreen).not.toBeChecked();
    expect(playLast).toBeChecked();

    await user.click(fullscreen);
    await user.click(playLast);
    expect(fullscreen).toBeChecked();
    expect(playLast).not.toBeChecked();
    await waitFor(async () => {
      expect(await settingsRepo.get('fullscreenOnLandscape')).toBe(true);
      expect(await settingsRepo.get('playLastChannelOnOpen')).toBe(false);
    });
  });

  it('UX-07: "Hide protected content" is off by default and is saved for the screens', async () => {
    const user = userEvent.setup();
    renderSettings(<PlaybackSection />);
    const hide = await screen.findByRole('switch', { name: text.hideProtected });
    expect(hide).not.toBeChecked();
    expect(hide).toHaveAccessibleDescription(text.hideProtectedHint);
    await user.click(hide);
    expect(hide).toBeChecked();
    await waitFor(async () => expect(await settingsRepo.get('hideProtectedContent')).toBe(true));
    cleanup();

    renderSettings(<PlaybackSection />);
    const again = await screen.findByRole('switch', { name: text.hideProtected });
    expect(again).toBeChecked();
    await user.click(again);
    await waitFor(async () => expect(await settingsRepo.get('hideProtectedContent')).toBe(false));
  });

  it('a failed save puts the switch back and says so', async () => {
    const user = userEvent.setup();
    renderSettings(<PlaybackSection />);
    const playLast = await screen.findByRole('switch', { name: text.playLastChannel });
    vi.spyOn(settingsRepo, 'set').mockRejectedValueOnce(new Error('quota'));
    await user.click(playLast);
    // The error toast is both visible and announced (assertive live region): check the live
    // region, the one element that holds it once (`findByText` would see two matches).
    await waitFor(() =>
      expect(screen.getByTestId('toast-assertive')).toHaveTextContent(text.saveError),
    );
    expect(playLast).not.toBeChecked();
  });

  it('a failed save rolls back only its own field (a concurrent change is kept)', async () => {
    const user = userEvent.setup();
    renderSettings(<PlaybackSection />);
    const fullscreen = await screen.findByRole('switch', { name: text.fullscreenOnLandscape });
    const playLast = screen.getByRole('switch', { name: text.playLastChannel });
    let rejectFullscreen!: (error: Error) => void;
    const original = settingsRepo.set.bind(settingsRepo);
    vi.spyOn(settingsRepo, 'set').mockImplementation((key, value) =>
      key === 'fullscreenOnLandscape'
        ? new Promise<void>((_resolve, reject) => {
            rejectFullscreen = reject;
          })
        : original(key, value),
    );
    await user.click(fullscreen); // on → off, save pending
    await user.click(playLast); // off → on, saved
    await waitFor(async () => expect(await settingsRepo.get('playLastChannelOnOpen')).toBe(true));
    rejectFullscreen(new Error('quota'));
    expect((await screen.findAllByText(text.saveError)).length).toBeGreaterThan(0);
    expect(fullscreen).toBeChecked(); // rolled back
    expect(playLast).toBeChecked(); // kept
  });

  it('live format: edits the active Xtream list (consumed by resolveStream)', async () => {
    await sourcesRepo.put(source('m3u', 'm3u-url', 1));
    await sourcesRepo.put(source('x', 'xtream', 2));
    await settingsRepo.set('activeSourceId', 'x');
    const user = userEvent.setup();
    renderSettings(<PlaybackSection />);
    const group = await screen.findByRole('radiogroup', { name: text.liveFormat });
    expect(screen.getByText(text.liveFormatHint('List x'))).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: text.liveFormats.auto })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: text.liveFormats.m3u8 }));
    expect(screen.getByRole('radio', { name: text.liveFormats.m3u8 })).toBeChecked();
    await waitFor(async () => expect((await sourcesRepo.get('x'))?.prefs.liveFormat).toBe('m3u8'));
    expect((await sourcesRepo.get('m3u'))?.prefs.liveFormat).toBe('auto');
    expect(group).toBeInTheDocument();
  });

  it('live format: disabled with an explanation for an M3U list, and without lists', async () => {
    await sourcesRepo.put(source('m3u', 'm3u-url'));
    const first = renderSettings(<PlaybackSection />);
    await screen.findByRole('radiogroup', { name: text.liveFormat });
    expect(screen.getByText(text.liveFormatNotXtream)).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    first.unmount();

    await wipeAll();
    forgetActiveSource();
    renderSettings(<PlaybackSection />);
    await screen.findByRole('radiogroup', { name: text.liveFormat });
    expect(screen.getByText(text.liveFormatNoList)).toBeInTheDocument();
  });
});
