// PLY-03: fullscreen, orientation and Picture-in-Picture, with mocked display APIs.
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_NOTE_MS, ROTATION_PROMPT_MS } from './useFullscreen';
import {
  installFullscreenApi,
  installOrientationLock,
  installOrientationQuery,
  installPictureInPicture,
  makeIOSVideo,
  type FakeIOSVideo,
} from './test-utils/fakeDisplay';
import {
  DESKTOP,
  IPHONE,
  LIVE,
  MOBILE,
  NONE,
  flush,
  key,
  renderPlayer,
} from './test-utils/renderPlayer';

const restores: Array<() => void> = [];
function use<T extends { restore: () => void }>(fake: T): T {
  restores.push(fake.restore);
  return fake;
}

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
  vi.useRealTimers();
});

const button = (name: string) => screen.getByRole('button', { name });

describe('PlayerView — fullscreen (Fullscreen API, AC1)', () => {
  it('the button and F put the player region (with its overlay) in fullscreen, and back', async () => {
    const fs = use(installFullscreenApi());
    const t = renderPlayer({ platform: DESKTOP });
    await flush();
    fireEvent.click(button('Fullscreen'));
    await flush();
    expect(fs.request).toHaveBeenCalledTimes(1);
    expect(fs.element()).toBe(t.region());
    // The overlay is inside the fullscreen element.
    expect(t.region()).toContainElement(screen.getByTestId('player-controls'));
    expect(button('Exit fullscreen')).toBeInTheDocument();
    key(t.region(), 'f');
    await flush();
    expect(fs.exit).toHaveBeenCalledTimes(1);
    expect(button('Fullscreen')).toBeInTheDocument();
    key(t.region(), 'F');
    await flush();
    expect(fs.element()).toBe(t.region());
  });

  it('Esc leaves fullscreen before closing the player', async () => {
    const fs = use(installFullscreenApi());
    const onClose = vi.fn();
    const t = renderPlayer({ platform: DESKTOP, onClose });
    await flush();
    key(t.region(), 'f');
    await flush();
    key(t.region(), 'Escape');
    await flush();
    expect(fs.exit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    key(t.region(), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('follows fullscreen changes made by the browser itself', async () => {
    const fs = use(installFullscreenApi());
    const t = renderPlayer({ platform: DESKTOP });
    await flush();
    key(t.region(), 'f');
    await flush();
    expect(button('Exit fullscreen')).toBeInTheDocument();
    act(() => fs.leaveExternally());
    expect(button('Fullscreen')).toBeInTheDocument();
  });

  it('a refused request changes nothing and throws nothing', async () => {
    const fs = use(installFullscreenApi());
    fs.refuseNext();
    const t = renderPlayer({ platform: DESKTOP });
    await flush();
    key(t.region(), 'f');
    await flush();
    expect(fs.request).toHaveBeenCalledTimes(1);
    expect(button('Fullscreen')).toBeInTheDocument();
  });

  it('no fullscreen at all: no button, F does nothing', async () => {
    const t = renderPlayer({ platform: NONE });
    await flush();
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull();
    key(t.region(), 'f');
  });

  it('leaving the player exits fullscreen and removes the listeners', async () => {
    const fs = use(installFullscreenApi());
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const t = renderPlayer({ platform: DESKTOP });
    await flush();
    key(t.region(), 'f');
    await flush();
    t.unmount();
    await flush();
    expect(fs.exit).toHaveBeenCalledTimes(1);
    const added = add.mock.calls.filter(([type]) => /fullscreenchange/.test(type)).length;
    const removed = remove.mock.calls.filter(([type]) => /fullscreenchange/.test(type)).length;
    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(added);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe('PlayerView — orientation (AC3)', () => {
  it('mobile: locks landscape after entering and unlocks on leaving', async () => {
    use(installFullscreenApi());
    const o = use(installOrientationLock());
    const t = renderPlayer({ platform: MOBILE });
    await flush();
    key(t.region(), 'f');
    await flush();
    expect(o.lock).toHaveBeenCalledWith('landscape');
    key(t.region(), 'f');
    await flush();
    expect(o.unlock).toHaveBeenCalledTimes(1);
  });

  it('a rejected lock (unsupported) is swallowed; desktop does not try to lock', async () => {
    use(installFullscreenApi());
    const o = use(installOrientationLock(true));
    const mobile = renderPlayer({ platform: MOBILE });
    await flush();
    key(mobile.region(), 'f');
    await flush();
    expect(o.lock).toHaveBeenCalledTimes(1);
    key(mobile.region(), 'f');
    await flush();
    expect(o.unlock).not.toHaveBeenCalled(); // nothing was locked
    mobile.unmount();

    const desktop = renderPlayer({ platform: DESKTOP });
    await flush();
    key(desktop.region(), 'f');
    await flush();
    expect(o.lock).toHaveBeenCalledTimes(1);
  });

  it('no screen.orientation.lock: fullscreen still works', async () => {
    const fs = use(installFullscreenApi());
    const t = renderPlayer({ platform: MOBILE });
    await flush();
    key(t.region(), 'f');
    await flush();
    expect(fs.element()).toBe(t.region());
  });

  it('mobile, playing: landscape offers fullscreen; the tap enters; portrait leaves (review #4)', async () => {
    const fs = use(installFullscreenApi());
    const q = use(installOrientationQuery());
    renderPlayer({ platform: MOBILE, descriptor: LIVE });
    await flush();
    act(() => q.rotate(true));
    await flush();
    // No request without a user gesture: only the prompt.
    expect(fs.request).not.toHaveBeenCalled();
    fireEvent.click(button('Tap for fullscreen'));
    await flush();
    expect(fs.request).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Tap for fullscreen' })).toBeNull();
    expect(button('Exit fullscreen')).toBeInTheDocument();
    act(() => q.rotate(false));
    await flush();
    expect(fs.exit).toHaveBeenCalledTimes(1);
  });

  it('the prompt goes away after a few seconds, and on portrait', async () => {
    vi.useFakeTimers();
    use(installFullscreenApi());
    const q = use(installOrientationQuery());
    renderPlayer({ platform: MOBILE, descriptor: LIVE });
    await flush();
    act(() => q.rotate(true));
    expect(button('Tap for fullscreen')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(ROTATION_PROMPT_MS));
    expect(screen.queryByRole('button', { name: 'Tap for fullscreen' })).toBeNull();
    act(() => q.rotate(false));
    act(() => q.rotate(true));
    expect(button('Tap for fullscreen')).toBeInTheDocument();
    act(() => q.rotate(false));
    expect(screen.queryByRole('button', { name: 'Tap for fullscreen' })).toBeNull();
  });

  it('a refused prompt tap does not arm the portrait exit', async () => {
    const fs = use(installFullscreenApi());
    const q = use(installOrientationQuery());
    const t = renderPlayer({ platform: MOBILE, descriptor: LIVE });
    await flush();
    act(() => q.rotate(true));
    fs.refuseNext();
    fireEvent.click(button('Tap for fullscreen'));
    await flush();
    expect(fs.element()).toBeNull();
    // Later, the user enters with the button; portrait must not leave it.
    key(t.region(), 'f');
    await flush();
    act(() => q.rotate(false));
    await flush();
    expect(fs.exit).not.toHaveBeenCalled();
  });

  it('portrait does not leave a fullscreen the user entered with the button', async () => {
    const fs = use(installFullscreenApi());
    const q = use(installOrientationQuery(true));
    const t = renderPlayer({ platform: MOBILE });
    await flush();
    key(t.region(), 'f');
    await flush();
    act(() => q.rotate(false));
    await flush();
    expect(fs.exit).not.toHaveBeenCalled();
  });

  it('option off, desktop default, or paused: rotation does nothing', async () => {
    const fs = use(installFullscreenApi());
    const q = use(installOrientationQuery());
    const off = renderPlayer({ platform: MOBILE, fullscreenOnLandscape: false });
    await flush();
    act(() => q.rotate(true));
    off.unmount();
    act(() => q.rotate(false));

    const desktop = renderPlayer({ platform: DESKTOP });
    await flush();
    act(() => q.rotate(true));
    desktop.unmount();
    act(() => q.rotate(false));

    const paused = renderPlayer({ platform: MOBILE });
    await flush();
    key(paused.region(), 'k');
    act(() => q.rotate(true));
    await flush();
    expect(fs.request).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Tap for fullscreen' })).toBeNull();
    paused.unmount();
    expect(q.listenerCount()).toBe(0);
  });
});

describe('PlayerView — iPhone system fullscreen (AC2)', () => {
  it('uses video.webkitEnterFullscreen() and says the controls are the system ones', async () => {
    vi.useFakeTimers();
    let ios: FakeIOSVideo | undefined;
    const t = renderPlayer(
      { platform: IPHONE },
      {
        beforePlay: (media) => {
          ios = makeIOSVideo(media.video);
        },
      },
    );
    await flush();
    fireEvent.click(button('Fullscreen'));
    expect(ios?.enterFullscreen).toHaveBeenCalledTimes(1);
    await flush();
    const note = screen.getByTestId('player-native-fullscreen-note');
    expect(note).toHaveAttribute('role', 'status');
    expect(note).toHaveTextContent(
      'On this device, fullscreen uses the system player and its controls.',
    );
    // Stays while the system player is open, then goes away after a while.
    act(() => vi.advanceTimersByTime(NATIVE_NOTE_MS * 2));
    expect(screen.getByTestId('player-native-fullscreen-note')).toBeInTheDocument();
    act(() => ios?.endFullscreen());
    act(() => vi.advanceTimersByTime(NATIVE_NOTE_MS));
    expect(screen.queryByTestId('player-native-fullscreen-note')).toBeNull();
    expect(t.region()).toBeInTheDocument();
  });

  it('native state follows the system player events; portrait exits only a prompt entry (review #10)', async () => {
    const q = use(installOrientationQuery());
    let ios: FakeIOSVideo | undefined;
    const t = renderPlayer(
      { platform: IPHONE, descriptor: LIVE },
      {
        beforePlay: (media) => {
          ios = makeIOSVideo(media.video);
        },
      },
    );
    await flush();
    const exitNative = () =>
      (t.media.video as unknown as { webkitExitFullscreen: ReturnType<typeof vi.fn> })
        .webkitExitFullscreen;

    // Entered with the button: portrait leaves it alone.
    fireEvent.click(button('Fullscreen'));
    await flush();
    act(() => q.rotate(true));
    act(() => q.rotate(false));
    expect(exitNative()).not.toHaveBeenCalled();
    act(() => ios?.endFullscreen());

    // Prompt tapped but the system player never opened: portrait does nothing.
    ios?.enterFullscreen.mockImplementationOnce(() => undefined);
    act(() => q.rotate(true));
    fireEvent.click(button('Tap for fullscreen'));
    await flush();
    act(() => q.rotate(false));
    expect(exitNative()).not.toHaveBeenCalled();

    // Prompt tapped and the system player opened (webkitbeginfullscreen): portrait leaves it.
    act(() => q.rotate(true));
    fireEvent.click(button('Tap for fullscreen'));
    await flush();
    act(() => q.rotate(false));
    expect(exitNative()).toHaveBeenCalledTimes(1);
  });

  it('the note can be dismissed', async () => {
    renderPlayer({ platform: IPHONE }, { beforePlay: (media) => makeIOSVideo(media.video) });
    await flush();
    fireEvent.click(button('Fullscreen'));
    await flush();
    fireEvent.click(button('Dismiss'));
    expect(screen.queryByTestId('player-native-fullscreen-note')).toBeNull();
  });
});

describe('PlayerView — Picture-in-Picture (AC4)', () => {
  it('supported: the button toggles PiP on the <video>', async () => {
    const pip = use(installPictureInPicture());
    const t = renderPlayer({ platform: DESKTOP });
    await flush();
    fireEvent.click(button('Picture-in-picture'));
    await flush();
    expect(pip.request).toHaveBeenCalledTimes(1);
    expect(pip.element()).toBe(t.media.video);
    fireEvent.click(button('Exit picture-in-picture'));
    await flush();
    expect(pip.exit).toHaveBeenCalledTimes(1);
    expect(button('Picture-in-picture')).toBeInTheDocument();
  });

  it('unsupported: no button', async () => {
    renderPlayer({ platform: DESKTOP });
    await flush();
    expect(screen.queryByRole('button', { name: 'Picture-in-picture' })).toBeNull();
    // The platform says no even if the element had the API.
    use(installPictureInPicture());
    renderPlayer({ platform: NONE, title: 'Other' });
    await flush();
    expect(screen.queryByRole('button', { name: 'Picture-in-picture' })).toBeNull();
  });

  it('Safari presentation mode (iPhone)', async () => {
    let ios: FakeIOSVideo | undefined;
    renderPlayer(
      { platform: IPHONE },
      {
        beforePlay: (media) => {
          ios = makeIOSVideo(media.video);
        },
      },
    );
    await flush();
    fireEvent.click(button('Picture-in-picture'));
    expect(ios?.setPresentationMode).toHaveBeenLastCalledWith('picture-in-picture');
    fireEvent.click(button('Exit picture-in-picture'));
    expect(ios?.setPresentationMode).toHaveBeenLastCalledWith('inline');
  });

  it('zapping or a change of the hook inputs keeps the PiP window open (review #8)', async () => {
    const pip = use(installPictureInPicture());
    const t = renderPlayer({ platform: DESKTOP, descriptor: LIVE });
    await flush();
    fireEvent.click(button('Picture-in-picture'));
    await flush();
    t.rerender({ descriptor: { ...LIVE, url: 'https://example.test/next.m3u8' } });
    await flush();
    // The detected API changes (the hook's effect re-runs): still no exit.
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      configurable: true,
      get: () => false,
    });
    t.rerender({ title: 'Channel' });
    await flush();
    expect(pip.exit).not.toHaveBeenCalled();
    expect(pip.element()).toBe(t.media.video);
    // Unmount still ends it.
    t.unmount();
    await flush();
    expect(pip.exit).toHaveBeenCalledTimes(1);
  });

  it('closing the player closes its PiP window', async () => {
    const pip = use(installPictureInPicture());
    const t = renderPlayer({ platform: DESKTOP });
    await flush();
    fireEvent.click(button('Picture-in-picture'));
    await flush();
    t.unmount();
    await flush();
    expect(pip.exit).toHaveBeenCalledTimes(1);
  });
});
