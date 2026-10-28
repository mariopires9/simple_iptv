import { describe, expect, it } from 'vitest';
import { planPlayback, selectEngine } from './select';
import type { EngineChoice, SelectionCapabilities } from './select';
import type { StreamContainer, StreamDescriptor } from './types';

const CONTAINERS = ['hls', 'ts', 'flv', 'mp4', 'webm', 'mov', 'mkv', 'avi', 'unknown'] as const;
// Compile-time exhaustiveness: adding a container to StreamContainer breaks this line until the
// matrix covers it.
const exhaustive: Exclude<StreamContainer, (typeof CONTAINERS)[number]> extends never
  ? true
  : false = true;

const PROFILES = {
  chromeDesktop: { mse: true, mms: false, nativeHls: false, isSafari: false, isIOS: false },
  chromeWithNativeHls: { mse: true, mms: false, nativeHls: true, isSafari: false, isIOS: false },
  firefox: { mse: true, mms: false, nativeHls: false, isSafari: false, isIOS: false },
  androidChrome: { mse: true, mms: false, nativeHls: true, isSafari: false, isIOS: false },
  safariMac: { mse: true, mms: true, nativeHls: true, isSafari: true, isIOS: false },
  safariNoNativeHls: { mse: true, mms: true, nativeHls: false, isSafari: true, isIOS: false },
  iosMms: { mse: false, mms: true, nativeHls: true, isSafari: true, isIOS: true },
  iosLegacy: { mse: false, mms: false, nativeHls: true, isSafari: true, isIOS: true },
  noMse: { mse: false, mms: false, nativeHls: false, isSafari: false, isIOS: false },
  noMseNativeHls: { mse: false, mms: false, nativeHls: true, isSafari: false, isIOS: false },
} satisfies Record<string, SelectionCapabilities>;

type Row = Record<(typeof CONTAINERS)[number], EngineChoice>;
const N = 'native';
const U = 'unsupported';
const native = { mp4: N, webm: N, mov: N, mkv: N, avi: U, unknown: U } as const;

// RESEARCH §5.2, container × capabilities × UA class.
const EXPECTED: Record<keyof typeof PROFILES, Row> = {
  chromeDesktop: { hls: 'hls', ts: 'mpegts', flv: 'mpegts', ...native },
  chromeWithNativeHls: { hls: 'hls', ts: 'mpegts', flv: 'mpegts', ...native },
  firefox: { hls: 'hls', ts: 'mpegts', flv: 'mpegts', ...native },
  androidChrome: { hls: 'hls', ts: 'mpegts', flv: 'mpegts', ...native },
  safariMac: { hls: 'native', ts: 'mpegts', flv: 'mpegts', ...native },
  safariNoNativeHls: { hls: 'hls', ts: 'mpegts', flv: 'mpegts', ...native },
  iosMms: { hls: 'native', ts: 'mpegts', flv: 'mpegts', ...native },
  iosLegacy: { hls: 'native', ts: U, flv: U, ...native },
  noMse: { hls: U, ts: U, flv: U, ...native },
  noMseNativeHls: { hls: 'native', ts: U, flv: U, ...native },
};

const descriptor = (
  container: StreamContainer,
  extra: Partial<StreamDescriptor> = {},
): StreamDescriptor => ({
  url: `https://example.test/stream.${container}`,
  kind: 'live',
  container,
  ...extra,
});

describe('selectEngine', () => {
  it('the matrix covers every container', () => {
    expect(exhaustive).toBe(true);
  });

  for (const [profile, caps] of Object.entries(PROFILES) as Array<
    [keyof typeof PROFILES, SelectionCapabilities]
  >) {
    for (const container of CONTAINERS) {
      const expected = EXPECTED[profile][container];
      it(`${profile} × ${container} → ${expected}`, () => {
        expect(selectEngine(descriptor(container), caps)).toBe(expected);
      });
    }
  }

  // Invariants over every boolean combination of the capabilities.
  const combos: SelectionCapabilities[] = [];
  for (let bits = 0; bits < 32; bits++) {
    combos.push({
      mse: (bits & 1) > 0,
      mms: (bits & 2) > 0,
      nativeHls: (bits & 4) > 0,
      isSafari: (bits & 8) > 0,
      isIOS: (bits & 16) > 0,
    });
  }

  it('never picks an MSE engine without MSE or MMS', () => {
    for (const caps of combos.filter((c) => !c.mse && !c.mms)) {
      for (const container of CONTAINERS) {
        expect(['native', 'unsupported']).toContain(selectEngine(descriptor(container), caps));
      }
    }
  });

  it('progressive containers are always native and AVI/unknown always unsupported', () => {
    for (const caps of combos) {
      for (const c of ['mp4', 'webm', 'mov', 'mkv'] as const)
        expect(selectEngine(descriptor(c), caps)).toBe('native');
      for (const c of ['avi', 'unknown'] as const)
        expect(selectEngine(descriptor(c), caps)).toBe('unsupported');
    }
  });

  it('HLS on Apple WebKit with native HLS is always native', () => {
    for (const caps of combos.filter((c) => (c.isSafari || c.isIOS) && c.nativeHls)) {
      expect(selectEngine(descriptor('hls'), caps)).toBe('native');
    }
  });

  it('VOD and live select the same engine', () => {
    for (const container of CONTAINERS) {
      expect(selectEngine(descriptor(container, { kind: 'vod' }), PROFILES.chromeDesktop)).toBe(
        selectEngine(descriptor(container), PROFILES.chromeDesktop),
      );
    }
  });
});

describe('planPlayback', () => {
  const xtreamLive = descriptor('ts', { fallbacks: [descriptor('hls')] });

  it('Xtream TS without MSE falls back to the .m3u8 variant (legacy iOS)', () => {
    expect(planPlayback(xtreamLive, PROFILES.iosLegacy).map((c) => c.engine)).toEqual([
      'unsupported',
      'native',
    ]);
  });

  it('keeps the requested descriptor first', () => {
    const plan = planPlayback(xtreamLive, PROFILES.chromeDesktop);
    expect(plan.map((c) => [c.descriptor.container, c.engine])).toEqual([
      ['ts', 'mpegts'],
      ['hls', 'hls'],
    ]);
  });

  it('ignores nested fallbacks', () => {
    const nested = descriptor('ts', {
      fallbacks: [descriptor('hls', { fallbacks: [descriptor('mp4')] })],
    });
    expect(planPlayback(nested, PROFILES.chromeDesktop)).toHaveLength(2);
  });

  it('a descriptor without fallbacks is a single candidate', () => {
    expect(planPlayback(descriptor('mp4'), PROFILES.noMse)).toEqual([
      { descriptor: descriptor('mp4'), engine: 'native' },
    ]);
  });
});
