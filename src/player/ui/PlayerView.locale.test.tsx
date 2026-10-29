// UX-06: a browser language change during playback never re-mounts the player. PlayerView holds
// the locale while mounted; the switch (and the app's keyed re-mount) waits until it is gone.
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeLocale,
  applyPendingLocale,
  installLanguagePreference,
  resetLanguagePreferenceForTests,
  setLocale,
} from '@/i18n';
import { LIVE, flush, renderPlayer } from './test-utils/renderPlayer';

afterEach(async () => {
  vi.restoreAllMocks();
  resetLanguagePreferenceForTests();
  await setLocale('en');
});

describe('PlayerView — locale hold (UX-06)', () => {
  it('a languagechange during playback is deferred until the player unmounts', async () => {
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    const cleanup = installLanguagePreference();
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

    player.unmount();
    await vi.waitFor(() => expect(activeLocale()).toBe('pt-PT'));
    cleanup();
  });
});
