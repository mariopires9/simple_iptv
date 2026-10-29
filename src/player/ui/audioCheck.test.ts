// PLY-04 AC3: "video but no audio" from the browsers' decoder counters.
import { describe, expect, it } from 'vitest';
import { audioMissing } from './audioCheck';

function withProps(props: Record<string, unknown>): HTMLVideoElement {
  const el = document.createElement('video');
  for (const [name, value] of Object.entries(props)) {
    Object.defineProperty(el, name, { configurable: true, value });
  }
  return el;
}

describe('audioMissing', () => {
  it('Chrome/Safari counters: video decoded, audio not', () => {
    expect(
      audioMissing(
        withProps({ webkitVideoDecodedByteCount: 1000, webkitAudioDecodedByteCount: 0 }),
      ),
    ).toBe(true);
    expect(
      audioMissing(
        withProps({ webkitVideoDecodedByteCount: 1000, webkitAudioDecodedByteCount: 5 }),
      ),
    ).toBe(false);
    // Nothing decoded yet: no claim.
    expect(
      audioMissing(withProps({ webkitVideoDecodedByteCount: 0, webkitAudioDecodedByteCount: 0 })),
    ).toBe(false);
  });

  it('Firefox: mozHasAudio false while a picture is shown', () => {
    expect(audioMissing(withProps({ mozHasAudio: false, videoWidth: 1280 }))).toBe(true);
    expect(audioMissing(withProps({ mozHasAudio: true, videoWidth: 1280 }))).toBe(false);
    expect(audioMissing(withProps({ mozHasAudio: false, videoWidth: 0 }))).toBe(false);
  });

  it('no counters at all: no claim', () => {
    expect(audioMissing(document.createElement('video'))).toBe(false);
  });
});
