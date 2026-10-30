// PLY-08: link builders per platform (with encoding), the `.m3u` content, the address handed off
// (direct, `.ts` preferred for live) and the default of the setting.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamDescriptor } from '../types';
import {
  defaultShowOpenInVlc,
  detectHandoffPlatform,
  externalStreamUrl,
  vlcAndroidLink,
  vlcIosLink,
  vlcPlaylist,
  vlcPlaylistFileName,
} from './index';
import { PLAYLIST_URL_REVOKE_MS, downloadBlob, handOffToVlc, type HandoffEnv } from './handoff';

// Synthetic credentials only.
const XTREAM = 'http://xtream.example:8080/live/demo/p%40ss%2Fw/1001.ts';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadAsMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

describe('detectHandoffPlatform', () => {
  it.each([
    [UA.iphone, 0, 'ios'],
    [UA.ipadAsMac, 5, 'ios'],
    [UA.ipadAsMac, 0, 'desktop'], // a real Mac
    [UA.android, 5, 'android'],
    [UA.windows, 0, 'desktop'],
  ] as const)('%s (%d touch points) → %s', (userAgent, maxTouchPoints, expected) => {
    expect(detectHandoffPlatform({ userAgent, maxTouchPoints })).toBe(expected);
  });
});

describe('defaultShowOpenInVlc (AC6)', () => {
  it('is on for iOS and Android, off on desktop', () => {
    expect(defaultShowOpenInVlc('ios')).toBe(true);
    expect(defaultShowOpenInVlc('android')).toBe(true);
    expect(defaultShowOpenInVlc('desktop')).toBe(false);
  });
});

describe('link builders (AC3)', () => {
  it('iOS: vlc-x-callback with the URL percent-encoded', () => {
    expect(vlcIosLink(XTREAM)).toBe(
      `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(XTREAM)}`,
    );
    expect(vlcIosLink('https://h.example/a.m3u8?x=1&y=2')).toBe(
      'vlc-x-callback://x-callback-url/stream?url=https%3A%2F%2Fh.example%2Fa.m3u8%3Fx%3D1%26y%3D2',
    );
  });

  it('Android: an intent for the VLC package with the scheme and an encoded title', () => {
    expect(vlcAndroidLink(XTREAM, 'Sport 1 HD; #A&B')).toBe(
      'intent://xtream.example:8080/live/demo/p%40ss%2Fw/1001.ts#Intent;scheme=http;' +
        'package=org.videolan.vlc;type=video/*;S.title=Sport%201%20HD%3B%20%23A%26B;end',
    );
    expect(vlcAndroidLink('https://h.example/v.mp4?t=1#frag', 'Film')).toBe(
      'intent://h.example/v.mp4?t=1#Intent;scheme=https;package=org.videolan.vlc;type=video/*;S.title=Film;end',
    );
    expect(vlcAndroidLink('rtmp://h.example/x', 'X')).toBeUndefined();
  });

  it('desktop: a one-entry M3U with the name and the URL', () => {
    expect(vlcPlaylist(XTREAM, 'Sport 1\nHD')).toBe(`#EXTM3U\n#EXTINF:-1,Sport 1 HD\n${XTREAM}\n`);
  });

  it('desktop: the file is named after the stream, sanitized', () => {
    expect(vlcPlaylistFileName('Sport 1 HD')).toBe('Sport 1 HD.m3u');
    expect(vlcPlaylistFileName('A/B: C* "D" <E>|?')).toBe('A_B_ C_ _D_ _E_.m3u');
    expect(vlcPlaylistFileName('../..')).toBe('stream.m3u');
    expect(vlcPlaylistFileName('   ')).toBe('stream.m3u');
    expect(vlcPlaylistFileName('x'.repeat(200))).toBe(`${'x'.repeat(80)}.m3u`);
  });
});

describe('externalStreamUrl (AC2)', () => {
  const hls: StreamDescriptor = { url: 'http://h.example/1.m3u8', kind: 'live', container: 'hls' };
  const ts: StreamDescriptor = { url: 'http://h.example/1.ts', kind: 'live', container: 'ts' };

  it('uses the explicit external address (the Xtream .ts) when given', () => {
    expect(externalStreamUrl({ ...hls, externalUrl: ts.url })).toBe(ts.url);
  });

  it('live: prefers the .ts of the chain, else the stream itself', () => {
    expect(externalStreamUrl({ ...hls, fallbacks: [ts] })).toBe(ts.url);
    expect(externalStreamUrl({ ...ts, fallbacks: [hls] })).toBe(ts.url);
    expect(externalStreamUrl(hls)).toBe(hls.url);
  });

  it('VOD: the container URL', () => {
    const vod: StreamDescriptor = {
      url: 'http://h.example/m/7.mkv',
      kind: 'vod',
      container: 'mkv',
    };
    expect(externalStreamUrl(vod)).toBe(vod.url);
  });
});

describe('handOffToVlc (AC3)', () => {
  const env = (platform: HandoffEnv['platform']) => ({
    platform,
    navigate: vi.fn<HandoffEnv['navigate']>(),
    download: vi.fn<HandoffEnv['download']>(),
  });

  it('iOS and Android navigate to the VLC link', () => {
    const ios = env('ios');
    expect(handOffToVlc(XTREAM, 'A', ios)).toBe('opened');
    expect(ios.navigate).toHaveBeenCalledWith(vlcIosLink(XTREAM));
    const android = env('android');
    expect(handOffToVlc(XTREAM, 'A', android)).toBe('opened');
    expect(android.navigate).toHaveBeenCalledWith(vlcAndroidLink(XTREAM, 'A'));
    expect(ios.download).not.toHaveBeenCalled();
  });

  it('desktop downloads the playlist', async () => {
    const desktop = env('desktop');
    expect(handOffToVlc(XTREAM, 'Sport/1', desktop)).toBe('downloaded');
    expect(desktop.navigate).not.toHaveBeenCalled();
    const [blob, name] = desktop.download.mock.calls[0] ?? [];
    expect(name).toBe('Sport_1.m3u');
    expect(await blob?.text()).toBe(vlcPlaylist(XTREAM, 'Sport/1'));
  });
});

describe('downloadBlob', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clicks a download link and revokes its object URL', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:fake');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadBlob(new Blob(['x']), 'a.m3u');
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('a.m3u');
    expect(anchor.isConnected).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PLAYLIST_URL_REVOKE_MS);
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });
});
