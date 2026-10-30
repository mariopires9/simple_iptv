// MSS-01: PlayerView publishes its title/artwork and play/pause/previous/next handlers to the
// Media Session, and clears them when it unmounts.
import { describe, expect, it, vi } from 'vitest';
import { LIVE, flush, renderPlayer } from './test-utils/renderPlayer';

describe('PlayerView — Media Session (MSS-01)', () => {
  function installMediaSession() {
    const handlers = new Map<string, (() => void) | null>();
    const session = {
      metadata: null as unknown,
      setActionHandler: vi.fn((action: string, handler: (() => void) | null) => {
        handlers.set(action, handler);
      }),
    };
    class FakeMetadata {
      constructor(readonly init: unknown) {}
    }
    Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
    vi.stubGlobal('MediaMetadata', FakeMetadata);
    return {
      session,
      handlers,
      restore() {
        delete (navigator as { mediaSession?: unknown }).mediaSession;
        vi.unstubAllGlobals();
      },
    };
  }

  it('shows the title and artwork, maps the buttons to zapping and clears them on close', async () => {
    const ms = installMediaSession();
    try {
      const onPrevious = vi.fn();
      const onNext = vi.fn();
      const { unmount, media } = renderPlayer({
        descriptor: LIVE,
        artwork: 'https://img.test/logo.png',
        onPrevious,
        onNext,
      });
      await flush();
      expect(ms.session.metadata).toEqual({
        init: { title: 'Channel', artwork: [{ src: 'https://img.test/logo.png' }] },
      });
      ms.handlers.get('nexttrack')?.();
      ms.handlers.get('previoustrack')?.();
      expect(onNext).toHaveBeenCalledTimes(1);
      expect(onPrevious).toHaveBeenCalledTimes(1);
      ms.handlers.get('pause')?.();
      expect(media.pause).toHaveBeenCalled();

      unmount();
      expect(ms.session.metadata).toBeNull();
      expect([...ms.handlers.values()].every((h) => h === null)).toBe(true);
    } finally {
      ms.restore();
    }
  });

  it('VOD: "next track" is the next item when given, and artwork must be http(s)', async () => {
    const ms = installMediaSession();
    try {
      const onNextItem = vi.fn();
      renderPlayer({ artwork: 'javascript:alert(1)', onNextItem });
      await flush();
      expect(ms.session.metadata).toEqual({ init: { title: 'Channel', artwork: [] } });
      expect(ms.handlers.get('previoustrack')).toBeNull();
      ms.handlers.get('nexttrack')?.();
      expect(onNextItem).toHaveBeenCalledTimes(1);
    } finally {
      ms.restore();
    }
  });
});
