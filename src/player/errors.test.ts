import { describe, expect, it } from 'vitest';
import {
  isMixedContent,
  isRecoverableHlsMediaError,
  mapHlsError,
  mapMediaError,
  mapMpegtsError,
  toPlaybackError,
} from './errors';
import type { ErrorContext } from './errors';
import { PlaybackError } from './types';

const SECRET_URL = 'http://iptv.example.test:8080/live/alice/s3cret/1234.ts';
const https = (engine: ErrorContext['engine'], url = SECRET_URL): ErrorContext => ({
  engine,
  url,
  pageProtocol: 'https:',
});
const local = (engine: ErrorContext['engine'], url = SECRET_URL): ErrorContext => ({
  engine,
  url,
  pageProtocol: 'http:',
});

describe('isMixedContent', () => {
  it('only http: URLs from an https: page', () => {
    expect(isMixedContent('http://a.test/x', 'https:')).toBe(true);
    expect(isMixedContent('HTTP://a.test/x', 'https:')).toBe(true);
    expect(isMixedContent('https://a.test/x', 'https:')).toBe(false);
    expect(isMixedContent('http://a.test/x', 'http:')).toBe(false);
    expect(isMixedContent('http://a.test/x', undefined)).toBe(false);
  });
});

describe('mapMediaError (native)', () => {
  it.each([
    [2, 'network', 'MEDIA_ERR_NETWORK'],
    [3, 'decode', 'MEDIA_ERR_DECODE'],
    [4, 'unsupported-container', 'MEDIA_ERR_SRC_NOT_SUPPORTED'],
    [1, 'unknown', 'MEDIA_ERR_ABORTED'],
    [undefined, 'unknown', 'MEDIA_ERR_UNKNOWN'],
  ] as const)('code %s → %s', (code, kind, detail) => {
    const e = mapMediaError(code, local('native'));
    expect(e).toMatchObject({ kind, detail, engine: 'native' });
  });

  it('SRC_NOT_SUPPORTED for an http stream on an https page is blocked mixed content', () => {
    expect(mapMediaError(4, https('native'))).toMatchObject({
      kind: 'blocked',
      hint: 'mixed-content',
    });
  });
});

describe('mapHlsError', () => {
  const net = (details: string, code?: number) => ({
    type: 'networkError',
    details,
    fatal: true,
    ...(code !== undefined ? { response: { code } } : {}),
  });

  it.each([
    [net('manifestLoadError', 0), 'blocked'],
    [net('manifestLoadError', 401), 'auth'],
    [net('levelLoadError', 403), 'auth'],
    [net('fragLoadError', 404), 'network'],
    [net('fragLoadError', 503), 'network'],
    [net('manifestLoadTimeOut', 0), 'network'],
    [net('fragLoadTimeOut'), 'network'],
    [
      { type: 'networkError', details: 'manifestParsingError', fatal: true },
      'unsupported-container',
    ],
    [{ type: 'networkError', details: 'levelEmptyError', fatal: true }, 'unsupported-container'],
    [
      { type: 'mediaError', details: 'manifestIncompatibleCodecsError', fatal: true },
      'unsupported-codec',
    ],
    [{ type: 'mediaError', details: 'bufferAddCodecError', fatal: true }, 'unsupported-codec'],
    [
      { type: 'mediaError', details: 'bufferIncompatibleCodecsError', fatal: true },
      'unsupported-codec',
    ],
    [{ type: 'mediaError', details: 'bufferAppendError', fatal: true }, 'decode'],
    [{ type: 'mediaError', details: 'fragParsingError', fatal: true }, 'decode'],
    [{ type: 'muxError', details: 'remuxAllocError', fatal: true }, 'decode'],
    [{ type: 'keySystemError', details: 'keySystemNoKeys', fatal: true }, 'unsupported-container'],
    [{ type: 'otherError', details: 'internalException', fatal: true }, 'unknown'],
  ] as const)('%o → %s', (data, kind) => {
    expect(mapHlsError(data, local('hls'))).toMatchObject({
      kind,
      engine: 'hls',
      detail: data.details,
    });
  });

  it('keeps the HTTP status and the blocked hint', () => {
    expect(mapHlsError(net('manifestLoadError', 401), local('hls')).status).toBe(401);
    expect(mapHlsError(net('manifestLoadError', 0), https('hls'))).toMatchObject({
      kind: 'blocked',
      hint: 'mixed-content',
    });
    expect(
      mapHlsError(net('manifestLoadError', 0), https('hls', 'https://cdn.test/a.m3u8')).hint,
    ).toBe('cors');
    expect(mapHlsError(net('manifestLoadError', 0), local('hls')).status).toBeUndefined();
  });

  it('media errors are recoverable once, codec errors are not', () => {
    expect(
      isRecoverableHlsMediaError({ type: 'mediaError', details: 'bufferAppendError', fatal: true }),
    ).toBe(true);
    expect(
      isRecoverableHlsMediaError({
        type: 'mediaError',
        details: 'bufferAddCodecError',
        fatal: true,
      }),
    ).toBe(false);
    expect(
      isRecoverableHlsMediaError({ type: 'networkError', details: 'fragLoadError', fatal: true }),
    ).toBe(false);
  });
});

describe('mapMpegtsError', () => {
  it.each([
    ['NetworkError', 'HttpStatusCodeInvalid', { code: 403, msg: 'Forbidden' }, 'auth'],
    ['NetworkError', 'HttpStatusCodeInvalid', { code: 401, msg: '' }, 'auth'],
    ['NetworkError', 'HttpStatusCodeInvalid', { code: 404, msg: '' }, 'network'],
    ['NetworkError', 'Exception', { code: -1, msg: 'Failed to fetch' }, 'blocked'],
    ['NetworkError', 'ConnectingTimeout', undefined, 'network'],
    ['NetworkError', 'UnrecoverableEarlyEof', undefined, 'network'],
    ['NetworkError', 'SomethingNew', undefined, 'network'],
    ['MediaError', 'CodecUnsupported', undefined, 'unsupported-codec'],
    ['MediaError', 'FormatUnsupported', undefined, 'unsupported-container'],
    ['MediaError', 'FormatError', undefined, 'unsupported-container'],
    ['MediaError', 'MediaMSEError', undefined, 'decode'],
    ['MediaError', 'SomethingNew', undefined, 'decode'],
    ['OtherError', 'x', undefined, 'unknown'],
  ] as const)('%s/%s → %s', (type, detail, info, kind) => {
    expect(mapMpegtsError(type, detail, info, local('mpegts'))).toMatchObject({
      kind,
      engine: 'mpegts',
      detail,
    });
  });

  it('keeps the status and flags mixed content', () => {
    expect(
      mapMpegtsError(
        'NetworkError',
        'HttpStatusCodeInvalid',
        { code: 403, msg: '' },
        local('mpegts'),
      ).status,
    ).toBe(403);
    expect(
      mapMpegtsError('NetworkError', 'Exception', { code: -1, msg: '' }, https('mpegts')).hint,
    ).toBe('mixed-content');
  });
});

describe('PlaybackError', () => {
  it('never exposes the stream URL or its credentials', () => {
    const errors = [
      mapMediaError(4, https('native')),
      mapHlsError(
        { type: 'networkError', details: 'manifestLoadError', fatal: true, response: { code: 0 } },
        https('hls'),
      ),
      mapMpegtsError('NetworkError', 'Exception', { code: -1, msg: SECRET_URL }, https('mpegts')),
      toPlaybackError(new Error(`failed ${SECRET_URL}`), https('hls')),
    ];
    for (const e of errors) {
      const serialized = `${e.message} ${JSON.stringify(e)} ${String(e.target)}`;
      expect(serialized).not.toContain('alice');
      expect(serialized).not.toContain('s3cret');
      expect(serialized).not.toContain('iptv.example.test');
      expect(e.target).toBe('http://***/live/***/***/***.ts');
    }
  });

  it('toPlaybackError keeps PlaybackErrors and wraps anything else as unknown', () => {
    const original = new PlaybackError({ kind: 'auth' });
    expect(toPlaybackError(original, local('hls'))).toBe(original);
    expect(toPlaybackError(new TypeError('x'), local('hls'))).toMatchObject({
      kind: 'unknown',
      detail: 'TypeError',
    });
    expect(toPlaybackError('boom', local('hls'))).toMatchObject({
      kind: 'unknown',
      detail: 'exception',
    });
  });

  it('describes kind, engine, detail and status in the message', () => {
    const e = new PlaybackError({
      kind: 'auth',
      engine: 'hls',
      detail: 'manifestLoadError',
      status: 401,
    });
    expect(e.message).toBe('Stream access rejected (auth, hls, manifestLoadError, HTTP 401)');
    expect(e.name).toBe('PlaybackError');
  });
});
