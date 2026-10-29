// PLY-04: PlaybackError → message mapping (AC2, AC4, AC5, AC7, AC8) and codec/container names.
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/en';
import { ptPT } from '@/i18n/pt-PT';
import { PlaybackError } from '../types';
import { containerName, formatCodecs } from './codecNames';
import { describePlaybackError, isTransientFailure } from './describePlaybackError';

const e = en.player.errors;

describe('describePlaybackError', () => {
  it('network: plain on VOD, "connection lost" on live (shown after the reconnects)', () => {
    const error = new PlaybackError({ kind: 'network' });
    expect(describePlaybackError(error)).toEqual(e.network);
    expect(describePlaybackError(error, { kind: 'vod' })).toEqual(e.network);
    expect(describePlaybackError(error, { kind: 'live' })).toEqual(e.networkLive);
  });

  it('PWA-04: offline, network and blocked failures say "no connection"; codecs keep theirs', () => {
    const context = { kind: 'live' as const, offline: true };
    expect(describePlaybackError(new PlaybackError({ kind: 'network' }), context)).toEqual(
      e.offline,
    );
    expect(describePlaybackError(new PlaybackError({ kind: 'blocked' }), context)).toEqual(
      e.offline,
    );
    expect(
      describePlaybackError(new PlaybackError({ kind: 'unsupported-codec' }), context),
    ).toEqual(e['unsupported-codec']);
    // Never promises offline playback.
    expect(e.offline.message).toMatch(/needs an internet connection/);
  });

  it('AC2: unsupported codec names the codec when known', () => {
    const known = describePlaybackError(
      new PlaybackError({ kind: 'unsupported-codec', codec: 'hvc1.1.6.L93.B0, ac-3' }),
    );
    expect(known.title).toBe('Format or codec not supported');
    expect(known.message).toBe(
      'This browser does not support the codec of this stream: HEVC (H.265), AC-3 (Dolby Digital).',
    );
    expect(describePlaybackError(new PlaybackError({ kind: 'unsupported-codec' }))).toEqual(
      e['unsupported-codec'],
    );
  });

  it('AC2: MEDIA_ERR_SRC_NOT_SUPPORTED / unsupported container → "format or codec not supported"', () => {
    const native = describePlaybackError(
      new PlaybackError({ kind: 'unsupported-container', detail: 'MEDIA_ERR_SRC_NOT_SUPPORTED' }),
    );
    expect(native).toEqual(e['unsupported-container']);
    expect(native.title).toBe('Format or codec not supported');
    expect(
      describePlaybackError(
        new PlaybackError({ kind: 'unsupported-container', detail: 'container:avi' }),
      ).message,
    ).toBe('This browser cannot play AVI streams.');
    expect(
      describePlaybackError(
        new PlaybackError({ kind: 'unsupported-container', detail: 'container:unknown' }),
      ),
    ).toEqual(e['unsupported-container']);
    expect(
      describePlaybackError(
        new PlaybackError({ kind: 'unsupported-container', detail: 'mseUnsupported' }),
      ).message,
    ).toBe(e.noMse);
  });

  it('AC4: 401/403 → account/connections message', () => {
    const text = describePlaybackError(new PlaybackError({ kind: 'auth', status: 403 }));
    expect(text).toEqual(e.auth);
    expect(text.message).toMatch(/simultaneous connections/);
  });

  it('AC5: blocked → HTTPS/CORS message with the diagnostics action', () => {
    expect(describePlaybackError(new PlaybackError({ kind: 'blocked', hint: 'cors' }))).toEqual({
      ...e.blocked,
      action: 'diagnostics',
    });
    expect(
      describePlaybackError(new PlaybackError({ kind: 'blocked', hint: 'mixed-content' })),
    ).toEqual({ ...e.blockedMixedContent, action: 'diagnostics' });
    expect(e.blocked.message).toMatch(/CORS/);
    expect(e.blocked.message).toMatch(/HTTPS/);
  });

  it('AC7: a DRM key-system failure → the DRM / DASH message', () => {
    const text = describePlaybackError(
      new PlaybackError({ kind: 'unsupported-container', detail: 'keySystemNoKeys' }),
    );
    expect(text).toEqual(e.drm);
    expect(text.title).toBe('This channel uses DRM / DASH, which this app does not support');
  });

  it('AC8: entry with required headers rejected with 401/403 → provider restriction', () => {
    for (const error of [
      new PlaybackError({ kind: 'auth', status: 401 }),
      new PlaybackError({ kind: 'auth', status: 403 }),
      new PlaybackError({ kind: 'auth' }),
    ]) {
      expect(describePlaybackError(error, { requiredHeaders: true })).toEqual(e.restricted);
    }
    // Other failures of such an entry keep their own message.
    expect(
      describePlaybackError(new PlaybackError({ kind: 'network' }), { requiredHeaders: true }),
    ).toEqual(e.network);
  });

  it('decode and unknown', () => {
    expect(describePlaybackError(new PlaybackError({ kind: 'decode' }))).toEqual(e.decode);
    expect(describePlaybackError(new PlaybackError({ kind: 'unknown' }))).toEqual(e.unknown);
  });

  it('every kind has a non-empty title and message in both locales', () => {
    for (const messages of [en.player.errors, ptPT.player.errors]) {
      for (const key of [
        'network',
        'networkLive',
        'blocked',
        'blockedMixedContent',
        'unsupported-container',
        'unsupported-codec',
        'decode',
        'auth',
        'restricted',
        'drm',
        'unknown',
      ] as const) {
        expect(messages[key].title.length).toBeGreaterThan(0);
        expect(messages[key].message.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('transient failures (review #2)', () => {
  it('network is always transient; blocked only once the stream has played', () => {
    expect(isTransientFailure(new PlaybackError({ kind: 'network' }), false)).toBe(true);
    const blocked = new PlaybackError({ kind: 'blocked', hint: 'cors', detail: 'Exception' });
    expect(isTransientFailure(blocked, false)).toBe(false);
    expect(isTransientFailure(blocked, true)).toBe(true);
    for (const kind of ['auth', 'unsupported-codec', 'unsupported-container', 'decode'] as const) {
      expect(isTransientFailure(new PlaybackError({ kind }), true)).toBe(false);
    }
  });

  it('a blocked drop after playback is described as a lost connection', () => {
    const blocked = new PlaybackError({ kind: 'blocked', hint: 'cors' });
    expect(describePlaybackError(blocked, { kind: 'live', afterStart: true })).toEqual(
      e.networkLive,
    );
    expect(describePlaybackError(blocked, { kind: 'live', afterStart: false })).toEqual({
      ...e.blocked,
      action: 'diagnostics',
    });
  });
});

describe('codec and container names', () => {
  it('maps common RFC 6381 codecs, keeps unknown ones and drops duplicates', () => {
    expect(formatCodecs('avc1.64001f, mp4a.40.2')).toBe('H.264, AAC');
    expect(formatCodecs('ac-3')).toBe('AC-3 (Dolby Digital)');
    expect(formatCodecs('mp4a.a6')).toBe('E-AC-3 (Dolby Digital Plus)');
    expect(formatCodecs('mp4a.6B')).toBe('MPEG audio (MP2/MP3)');
    expect(formatCodecs('mp4a.40.34')).toBe('MP3');
    expect(formatCodecs('avc1.4d401e,avc3.640028')).toBe('H.264');
    expect(formatCodecs('xyz9')).toBe('xyz9');
  });

  it('names known containers only', () => {
    expect(containerName('ts')).toBe('MPEG-TS');
    expect(containerName('mkv')).toBe('MKV');
    expect(containerName('unknown')).toBeUndefined();
    expect(containerName('toString')).toBeUndefined();
  });
});
