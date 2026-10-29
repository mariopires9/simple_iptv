// PLY-06 C: the live stream check — what each probed format means for the engine that would
// play it, and which actions follow.
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { ptPT } from '@/i18n/pt-PT';
import type { ProbeCause } from '@/player/probe';
import { checkLiveStream, type LiveStreamProbe, type PlaybackCaps } from './checks';
import { describeCheck } from './describe';

const CHROME: PlaybackCaps = { mse: true, mms: false, nativeHls: false, isSafari: false };
const IPHONE: PlaybackCaps = { mse: false, mms: true, nativeHls: true, isSafari: true };

function probe(
  format: 'ts' | 'm3u8',
  engine: LiveStreamProbe['engine'],
  cause: ProbeCause,
  extra: Partial<LiveStreamProbe['result']> = {},
): LiveStreamProbe {
  return {
    format,
    engine,
    result: { cause, target: `https://***/live/***/***/***.${format}`, ...extra },
    finding: cause === 'no-cors' && engine === 'native' ? 'no-cors-native' : cause,
  };
}

const probed = (...probes: LiveStreamProbe[]) => ({ outcome: 'probed' as const, probes });

describe('checkLiveStream', () => {
  it('the iPhone report: TS without CORS, HLS redirected to http → error, device app', () => {
    const check = checkLiveStream({
      kind: 'xtream',
      configured: 'auto',
      caps: IPHONE,
      outcome: probed(
        probe('ts', 'mpegts', 'no-cors'),
        probe('m3u8', 'native', 'insecure-redirect', { redirected: true }),
      ),
    });
    expect(check).toMatchObject({
      status: 'error',
      reason: 'insecure-redirect',
      actions: ['device-app', 'contact-provider'],
    });
    expect(describeCheck(check, t.diagnostics).explanation).toBe(
      t.player.probe.causes['insecure-redirect'],
    );
  });

  it('one format works → warning, suggests it for an Xtream list', () => {
    const check = checkLiveStream({
      kind: 'xtream',
      configured: 'auto',
      caps: IPHONE,
      outcome: probed(probe('ts', 'mpegts', 'no-cors'), probe('m3u8', 'native', 'ok')),
    });
    expect(check).toMatchObject({ status: 'warning', reason: 'partial', suggested: 'm3u8' });
    expect(check.actions[0]).toBe('switch-live-format');
    expect(describeCheck(check, t.diagnostics).suggestedFormat).toBe('m3u8');
  });

  it('no CORS does not stop the native player: that format is inconclusive, not working', () => {
    const check = checkLiveStream({
      kind: 'xtream',
      configured: 'auto',
      caps: IPHONE,
      outcome: probed(probe('ts', 'mpegts', 'no-cors'), probe('m3u8', 'native', 'no-cors')),
    });
    expect(check).toMatchObject({ status: 'warning', reason: 'no-cors' });
    expect(check).not.toHaveProperty('suggested');
  });

  it('no suggestion when the list already uses the working format, nor for M3U', () => {
    const outcome = probed(probe('ts', 'mpegts', 'ok'), probe('m3u8', 'hls', 'unreachable'));
    expect(
      checkLiveStream({ kind: 'xtream', configured: 'ts', caps: CHROME, outcome }),
    ).not.toHaveProperty('suggested');
    expect(checkLiveStream({ kind: 'm3u-url', caps: CHROME, outcome }).actions).not.toContain(
      'switch-live-format',
    );
  });

  it('every format plays → ok; HEVC → warning with the hint', () => {
    expect(
      checkLiveStream({
        kind: 'xtream',
        caps: CHROME,
        outcome: probed(probe('ts', 'mpegts', 'ok'), probe('m3u8', 'hls', 'ok')),
      }),
    ).toMatchObject({ status: 'ok', reason: 'ok', actions: [] });
    const hevc = checkLiveStream({
      kind: 'xtream',
      caps: CHROME,
      outcome: probed(probe('ts', 'mpegts', 'ok', { hevc: true })),
    });
    expect(hevc).toMatchObject({ status: 'warning', hevc: true, actions: ['safari'] });
    expect(describeCheck(hevc, t.diagnostics).explanation).toContain(t.player.probe.hevc);
  });

  it('CORS / unreachable without a working format → error with matching actions', () => {
    expect(
      checkLiveStream({
        kind: 'xtream',
        caps: CHROME,
        outcome: probed(probe('ts', 'mpegts', 'unreachable'), probe('m3u8', 'hls', 'no-cors')),
      }),
    ).toMatchObject({
      status: 'error',
      reason: 'no-cors',
      actions: ['safari', 'contact-provider', 'proxy-future'],
    });
  });

  it('skipped outcomes', () => {
    for (const outcome of ['no-channels', 'offline', 'no-secret', 'unavailable'] as const) {
      expect(checkLiveStream({ kind: 'xtream', caps: CHROME, outcome: { outcome } })).toMatchObject(
        { status: 'skipped', reason: outcome },
      );
    }
  });

  it('facts list each format with its engine, result and masked address (en and pt-PT)', () => {
    const check = checkLiveStream({
      kind: 'xtream',
      caps: IPHONE,
      outcome: probed(
        probe('ts', 'mpegts', 'no-cors'),
        probe('m3u8', 'native', 'redirect-blocked', { redirected: true }),
      ),
    });
    const en = describeCheck(check, t.diagnostics, t.player.probe);
    expect(en.facts).toEqual([
      'MPEG-TS (mpegts.js): no CORS headers (web engines cannot read it) — https://***/live/***/***/***.ts',
      'HLS (native player): redirects to an address the browser could not open (redirected) — https://***/live/***/***/***.m3u8',
    ]);
    const pt = describeCheck(check, ptPT.diagnostics, ptPT.player.probe);
    expect(pt.title).toBe('Teste de stream em direto');
    expect(pt.explanation).toBe(ptPT.player.probe.causes['redirect-blocked']);
  });
});
