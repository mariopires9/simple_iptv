// SRC-09 AC1/AC2: unit tests of the checkers (each failure carries actions).
import { describe, expect, it } from 'vitest';
import { NetError } from '@/core/net';
import {
  checkApi,
  checkBrowser,
  checkCodecs,
  checkHttps,
  checkLiveFormat,
  overallStatus,
  type PlaybackCaps,
} from './checks';
import { CODECS, type CodecSupport } from './codecs';

const CHROME: PlaybackCaps = { mse: true, mms: false, nativeHls: false, isSafari: false };
const IPHONE: PlaybackCaps = { mse: false, mms: true, nativeHls: true, isSafari: true };
const OLD_IPHONE: PlaybackCaps = { mse: false, mms: false, nativeHls: true, isSafari: true };
const NOTHING: PlaybackCaps = { mse: false, mms: false, nativeHls: false, isSafari: false };

describe('checkHttps', () => {
  it('https list → ok', () => {
    expect(
      checkHttps({ kind: 'xtream', sourceProtocol: 'https:', pageProtocol: 'https:' }),
    ).toMatchObject({ status: 'ok', reason: 'https', actions: [] });
  });

  it('http list on the https app → error (mixed content) with HTTPS, file and future proxy', () => {
    const check = checkHttps({ kind: 'm3u-url', sourceProtocol: 'http:', pageProtocol: 'https:' });
    expect(check).toMatchObject({ status: 'error', reason: 'http-blocked' });
    expect(check.actions).toEqual(['use-https', 'local-file', 'proxy-future']);
  });

  it('http list on a local http page → warning (blocked once published)', () => {
    expect(
      checkHttps({ kind: 'xtream', sourceProtocol: 'http:', pageProtocol: 'http:' }),
    ).toMatchObject({ status: 'warning', reason: 'http-local', actions: ['use-https'] });
  });

  it('records that the server also answers over HTTPS', () => {
    expect(
      checkHttps({
        kind: 'xtream',
        sourceProtocol: 'http:',
        pageProtocol: 'https:',
        httpsAvailable: true,
      }).httpsAvailable,
    ).toBe(true);
  });

  it('a local file needs no HTTPS', () => {
    expect(
      checkHttps({ kind: 'm3u-file', sourceProtocol: undefined, pageProtocol: 'https:' }),
    ).toMatchObject({ status: 'skipped', reason: 'not-applicable' });
  });
});

describe('checkApi (NetError classification)', () => {
  const err = (init: ConstructorParameters<typeof NetError>[0]) => ({
    outcome: 'error' as const,
    error: new NetError(init),
  });

  it.each([
    [{ outcome: 'ok' as const }, 'ok', 'ok'],
    [{ outcome: 'offline' as const }, 'skipped', 'offline'],
    [{ outcome: 'no-secret' as const }, 'skipped', 'no-secret'],
    [{ outcome: 'not-applicable' as const }, 'skipped', 'not-applicable'],
    [err({ kind: 'blocked', hint: 'mixed-content' }), 'error', 'mixed-content'],
    [err({ kind: 'blocked', hint: 'cors' }), 'error', 'cors'],
    [err({ kind: 'blocked' }), 'error', 'network-error'],
    [err({ kind: 'timeout' }), 'error', 'timeout'],
    [err({ kind: 'offline' }), 'skipped', 'offline'],
    [err({ kind: 'auth', status: 401 }), 'warning', 'auth-rejected'],
    [err({ kind: 'http', status: 502 }), 'error', 'http-error'],
    [err({ kind: 'parse' }), 'error', 'invalid-response'],
  ])('%o → %s / %s', (probe, status, reason) => {
    expect(checkApi(probe, 'xtream')).toMatchObject({ status, reason });
  });

  it('every error has at least one action', () => {
    for (const kind of ['blocked', 'timeout', 'http', 'parse', 'auth', 'aborted'] as const) {
      const check = checkApi(err({ kind }), 'xtream');
      expect(check.actions.length, kind).toBeGreaterThan(0);
    }
  });

  it('CORS: local file, provider, future proxy — never a workaround', () => {
    expect(checkApi(err({ kind: 'blocked', hint: 'cors' }), 'm3u-url').actions).toEqual([
      'local-file',
      'contact-provider',
      'proxy-future',
    ]);
  });

  it('an M3U URL answering 401/403 is a provider refusal, not a login', () => {
    expect(checkApi(err({ kind: 'auth', status: 403 }), 'm3u-url')).toMatchObject({
      status: 'error',
      reason: 'http-error',
    });
  });

  it('keeps the HTTP status', () => {
    expect(checkApi(err({ kind: 'http', status: 502 }), 'xtream').httpStatus).toBe(502);
  });
});

describe('checkLiveFormat', () => {
  it('Xtream auto on Chrome: TS via mpegts.js, HLS via hls.js', () => {
    const check = checkLiveFormat({ kind: 'xtream', configured: 'auto', caps: CHROME });
    expect(check).toMatchObject({ status: 'ok', reason: 'ok', configured: 'auto' });
    expect(check.support).toEqual({ ts: 'mpegts', hls: 'hls' });
  });

  it('Xtream TS chosen but the account only allows HLS → warning, switch format', () => {
    expect(
      checkLiveFormat({ kind: 'xtream', configured: 'ts', allowed: ['m3u8'], caps: CHROME }),
    ).toMatchObject({
      status: 'warning',
      reason: 'format-not-allowed',
      actions: ['switch-live-format'],
      allowed: ['m3u8'],
    });
  });

  it('Xtream TS chosen on a browser without MSE/MMS → warning, switch format', () => {
    expect(checkLiveFormat({ kind: 'xtream', configured: 'ts', caps: OLD_IPHONE })).toMatchObject({
      status: 'warning',
      reason: 'format-unplayable',
    });
  });

  it('Xtream account allows only TS and the browser has no MSE/MMS → error', () => {
    expect(
      checkLiveFormat({ kind: 'xtream', configured: 'auto', allowed: ['ts'], caps: OLD_IPHONE }),
    ).toMatchObject({ status: 'error', reason: 'none-playable', actions: [] });
  });

  it('suggests Safari only when not already on it', () => {
    expect(checkLiveFormat({ kind: 'xtream', configured: 'auto', caps: NOTHING }).actions).toEqual([
      'safari',
    ]);
  });

  it('M3U: depends on each channel; reports partial support', () => {
    expect(checkLiveFormat({ kind: 'm3u-url', caps: CHROME })).toMatchObject({
      status: 'ok',
      reason: 'per-channel',
    });
    expect(checkLiveFormat({ kind: 'm3u-file', caps: OLD_IPHONE })).toMatchObject({
      status: 'warning',
      reason: 'per-channel-partial',
      support: { ts: 'unsupported', hls: 'native' },
    });
  });

  it('"hls" in allowed_output_formats counts as HLS', () => {
    expect(
      checkLiveFormat({ kind: 'xtream', configured: 'm3u8', allowed: [' HLS '], caps: CHROME }),
    ).toMatchObject({ status: 'ok' });
  });
});

describe('checkBrowser', () => {
  it.each([
    [CHROME, 'ok', 'mse'],
    [IPHONE, 'ok', 'mms'],
    [OLD_IPHONE, 'warning', 'native-hls-only'],
    [NOTHING, 'error', 'none'],
  ] as const)('%o → %s / %s', (caps, status, reason) => {
    expect(checkBrowser(caps)).toMatchObject({ status, reason });
  });
});

describe('checkCodecs', () => {
  const support = (missing: string[], nativeOnly: string[] = []): CodecSupport[] =>
    CODECS.map((codec) => ({
      codec,
      mediaSource: !missing.includes(codec) && !nativeOnly.includes(codec),
      native: !missing.includes(codec) && nativeOnly.includes(codec),
    }));

  it('all supported → ok', () => {
    expect(checkCodecs(support([]), CHROME)).toMatchObject({ status: 'ok', missing: [] });
  });

  it('a codec supported only natively still counts', () => {
    expect(checkCodecs(support([], ['ac3']), CHROME).status).toBe('ok');
  });

  it('Dolby/HEVC missing → warning with Safari', () => {
    expect(checkCodecs(support(['ac3', 'eac3']), CHROME)).toMatchObject({
      status: 'warning',
      reason: 'optional-missing',
      missing: ['ac3', 'eac3'],
      actions: ['safari'],
    });
  });

  it('H.264 or AAC missing → error', () => {
    expect(checkCodecs(support(['aac']), CHROME)).toMatchObject({
      status: 'error',
      reason: 'required-missing',
    });
  });
});

describe('overallStatus', () => {
  it('worst first; all skipped → skipped', () => {
    const ok = checkBrowser(CHROME);
    const warning = checkBrowser(OLD_IPHONE);
    const error = checkBrowser(NOTHING);
    const skipped = checkApi({ outcome: 'offline' }, 'xtream');
    expect(overallStatus([ok, warning, error])).toBe('error');
    expect(overallStatus([ok, skipped, warning])).toBe('warning');
    expect(overallStatus([skipped, ok])).toBe('ok');
    expect(overallStatus([skipped])).toBe('skipped');
  });
});
