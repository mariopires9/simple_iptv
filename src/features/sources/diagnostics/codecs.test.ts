// SRC-09 AC1: codec probes via isTypeSupported (MSE / ManagedMediaSource) and canPlayType.
import { describe, expect, it } from 'vitest';
import type { PlatformEnv } from '@/core/platform';
import { CODECS, CODEC_MIME_TYPES, probeCodecs } from './codecs';

function env(options: {
  mse?: (mime: string) => boolean;
  mms?: (mime: string) => boolean;
  native?: (mime: string) => string;
}): PlatformEnv {
  return {
    MediaSource: options.mse ? { isTypeSupported: options.mse } : undefined,
    ManagedMediaSource: options.mms ? { isTypeSupported: options.mms } : undefined,
    createVideo: () => ({ canPlayType: options.native ?? (() => '') }),
    document: {},
    navigator: { userAgent: 'test' },
  };
}

describe('probeCodecs', () => {
  it('probes every codec, in display order', () => {
    expect(probeCodecs(env({})).map((c) => c.codec)).toEqual(CODECS);
  });

  it('Chrome-like: H.264/AAC/HEVC via MSE, no Dolby', () => {
    const supported = new Set([
      ...CODEC_MIME_TYPES.h264,
      ...CODEC_MIME_TYPES.aac,
      ...CODEC_MIME_TYPES.hevc,
    ]);
    const result = probeCodecs(env({ mse: (mime) => supported.has(mime) }));
    expect(result.filter((c) => c.mediaSource).map((c) => c.codec)).toEqual([
      'h264',
      'aac',
      'hevc',
    ]);
    expect(result.every((c) => !c.native)).toBe(true);
  });

  it('Safari-like: ManagedMediaSource and canPlayType both count', () => {
    const result = probeCodecs(env({ mms: () => true, native: () => 'maybe' }));
    expect(result.every((c) => c.mediaSource && c.native)).toBe(true);
  });

  it('a throwing probe counts as unsupported', () => {
    const result = probeCodecs(
      env({
        mse: () => {
          throw new Error('boom');
        },
        native: () => {
          throw new Error('boom');
        },
      }),
    );
    expect(result.every((c) => !c.mediaSource && !c.native)).toBe(true);
  });
});
