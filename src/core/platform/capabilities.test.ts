import { describe, expect, it } from 'vitest';
import { getCapabilities } from './capabilities';
import type { PlatformEnv } from './capabilities';

const UA = {
  chromeDesktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  chromeIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
};

const supports = (types: string[]) => ({
  isTypeSupported: (t: string) => types.some((s) => t.startsWith(s)),
});

function env(
  overrides: Partial<PlatformEnv> & { canPlayType?: Record<string, string> } = {},
): PlatformEnv {
  const { canPlayType = {}, ...rest } = overrides;
  return {
    createVideo: () => ({ canPlayType: (t: string) => canPlayType[t] ?? '' }),
    document: {},
    navigator: { userAgent: UA.chromeDesktop, vendor: 'Google Inc.', platform: 'Win32' },
    ...rest,
  };
}

describe('getCapabilities', () => {
  it('desktop Chrome: MSE, no MMS, no Apple', () => {
    const caps = getCapabilities(
      env({
        MediaSource: supports(['video/mp4']),
        document: { pictureInPictureEnabled: true, fullscreenEnabled: true },
      }),
    );
    expect(caps).toMatchObject({
      mse: true,
      mms: false,
      nativeHls: false,
      isIOS: false,
      isSafari: false,
      pip: true,
      fullscreenApi: true,
    });
  });

  it('Chrome reporting native HLS is still not Safari', () => {
    const caps = getCapabilities(
      env({
        MediaSource: supports(['video/mp4']),
        canPlayType: { 'application/vnd.apple.mpegurl': 'maybe' },
        navigator: { userAgent: UA.chromeAndroid, vendor: 'Google Inc.', platform: 'Linux armv8l' },
      }),
    );
    expect(caps.nativeHls).toBe(true);
    expect(caps.isSafari).toBe(false);
  });

  it('Firefox is not Safari', () => {
    const caps = getCapabilities(
      env({ MediaSource: supports([]), navigator: { userAgent: UA.firefox, vendor: '' } }),
    );
    expect(caps.isSafari).toBe(false);
    expect(caps.mse).toBe(true);
  });

  it('Safari on macOS: MSE + MMS + native HLS', () => {
    const caps = getCapabilities(
      env({
        MediaSource: supports(['video/mp4']),
        ManagedMediaSource: supports(['video/mp4']),
        canPlayType: { 'application/vnd.apple.mpegurl': 'maybe' },
        navigator: {
          userAgent: UA.safariMac,
          vendor: 'Apple Computer, Inc.',
          platform: 'MacIntel',
          maxTouchPoints: 0,
        },
        document: { fullscreenEnabled: true, pictureInPictureEnabled: true },
      }),
    );
    expect(caps).toMatchObject({
      mse: true,
      mms: true,
      nativeHls: true,
      isSafari: true,
      isIOS: false,
    });
  });

  it('iPhone (iOS 17.1+): MMS only, native HLS, no element Fullscreen API, Safari PiP', () => {
    const caps = getCapabilities(
      env({
        ManagedMediaSource: supports(['video/mp4']),
        createVideo: () => ({
          canPlayType: (t: string) => (t === 'application/x-mpegURL' ? 'maybe' : ''),
          webkitEnterFullscreen: () => undefined,
          webkitSetPresentationMode: () => undefined,
        }),
        navigator: {
          userAgent: UA.iPhone,
          vendor: 'Apple Computer, Inc.',
          platform: 'iPhone',
          maxTouchPoints: 5,
        },
      }),
    );
    expect(caps).toMatchObject({
      mse: false,
      mms: true,
      nativeHls: true,
      isIOS: true,
      isSafari: true,
      pip: true,
      fullscreenApi: false,
    });
  });

  it('older iPhone without MSE or MMS', () => {
    const caps = getCapabilities(
      env({
        canPlayType: { 'application/vnd.apple.mpegurl': 'probably' },
        navigator: { userAgent: UA.iPhone, vendor: 'Apple Computer, Inc.', platform: 'iPhone' },
      }),
    );
    expect(caps).toMatchObject({ mse: false, mms: false, nativeHls: true, isIOS: true });
  });

  it('iPadOS with a desktop user agent is detected through touch points', () => {
    const caps = getCapabilities(
      env({
        navigator: {
          userAgent: UA.safariMac,
          vendor: 'Apple Computer, Inc.',
          platform: 'MacIntel',
          maxTouchPoints: 5,
        },
      }),
    );
    expect(caps.isIOS).toBe(true);
  });

  it('third-party iOS browsers use WebKit and count as Safari', () => {
    const caps = getCapabilities(
      env({
        navigator: { userAgent: UA.chromeIOS, vendor: 'Apple Computer, Inc.', platform: 'iPhone' },
      }),
    );
    expect(caps).toMatchObject({ isIOS: true, isSafari: true });
  });

  it('canPlay checks the element and MSE/MMS, tolerating exceptions', () => {
    const caps = getCapabilities(
      env({
        canPlayType: { 'video/mp4': 'maybe' },
        MediaSource: {
          isTypeSupported: (t: string) => {
            if (t.includes('throw')) throw new Error('boom');
            return t === 'video/mp2t; codecs="avc1.64001f"';
          },
        },
      }),
    );
    expect(caps.canPlay('video/mp4')).toBe(true);
    expect(caps.canPlay('video/mp2t; codecs="avc1.64001f"')).toBe(true);
    expect(caps.canPlay('audio/ac3')).toBe(false);
    expect(caps.canPlay('video/throw')).toBe(false);
  });

  it('ignores MediaSource globals without isTypeSupported', () => {
    const caps = getCapabilities(env({ MediaSource: {} as never }));
    expect(caps.mse).toBe(false);
  });

  it('webkitFullscreenEnabled counts as the Fullscreen API', () => {
    expect(
      getCapabilities(env({ document: { webkitFullscreenEnabled: true } })).fullscreenApi,
    ).toBe(true);
  });

  it('works with the default browser environment (jsdom)', () => {
    const caps = getCapabilities();
    expect(caps.mse).toBe(false);
    expect(typeof caps.canPlay('video/mp4')).toBe('boolean');
  });
});
