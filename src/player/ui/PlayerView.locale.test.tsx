// UX-06: a browser language change during playback never re-mounts the player. PlayerView holds
// the "player open" claim while mounted (TEC-03: the PWA-03 signal); the switch (and the app's
// keyed re-mount) waits until it is gone.
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPlaybackActive, subscribePlayback } from '@/core/session/playback';
import {
  activeLocale,
  applyPendingLocale,
  installLanguagePreference,
  resetLanguagePreferenceForTests,
  setLocale,
} from '@/i18n';
import { LIVE, flush, renderPlayer } from './test-utils/renderPlayer';

/** The app's "player open" signal (src/app/App.tsx). */
const PLAYER = [isPlaybackActive, subscribePlayback] as const;

afterEach(async () => {
  vi.restoreAllMocks();
  resetLanguagePreferenceForTests();
  await setLocale('en');
});

describe('PlayerView — locale hold (UX-06)', () => {
  it('a languagechange during playback is deferred until the player unmounts', async () => {
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    const cleanup = installLanguagePreference(...PLAYER);
    const player = renderPlayer({ descriptor: LIVE });
    await flush();
    const region = player.region();

    languages.mockReturnValue(['pt-PT']);
    act(() => {
      window.dispatchEvent(new Event('languagechange'));
    });
    act(() => applyPendingLocale()); // e.g. a channel change updates the URL
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(activeLocale()).toBe('en');
    expect(region).toBeInTheDocument();
    expect(screen.getByRole('region')).toBe(region);
    expect(isPlaybackActive()).toBe(true); // the same signal holds app updates (PWA-03)

    player.unmount();
    expect(isPlaybackActive()).toBe(false);
    await vi.waitFor(() => expect(activeLocale()).toBe('pt-PT'));
    cleanup();
  });
});
