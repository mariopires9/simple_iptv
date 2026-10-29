import { describe, expect, it } from 'vitest';
import { NATIVE_AUDIO_CONTAINER, containerOfExtension, declaredContainer } from './containers';

describe('containerOfExtension', () => {
  it.each([
    ['m3u8', 'hls'],
    ['M3U', 'hls'],
    ['ts', 'ts'],
    ['mpegts', 'ts'],
    ['mp4', 'mp4'],
    ['m4v', 'mp4'],
    ['mkv', 'mkv'],
    ['webm', 'webm'],
    ['mov', 'mov'],
    ['flv', 'flv'],
    ['avi', 'avi'],
    ['mpd', 'dash'],
    ['mp3', NATIVE_AUDIO_CONTAINER],
    ['aac', NATIVE_AUDIO_CONTAINER],
    ['m4a', NATIVE_AUDIO_CONTAINER],
    ['ogg', NATIVE_AUDIO_CONTAINER],
    ['oga', NATIVE_AUDIO_CONTAINER],
    ['opus', NATIVE_AUDIO_CONTAINER],
    ['flac', NATIVE_AUDIO_CONTAINER],
    ['wav', NATIVE_AUDIO_CONTAINER],
  ] as const)('%s → %s', (ext, container) => {
    expect(containerOfExtension(ext)).toBe(container);
  });

  it.each([['php'], ['hls'], ['dash'], ['constructor'], ['toString'], [''], [undefined]])(
    '%s is not a file extension',
    (ext) => {
      expect(containerOfExtension(ext)).toBeUndefined();
    },
  );
});

describe('declaredContainer', () => {
  it.each([
    ['hls', 'hls'],
    [' DASH ', 'dash'],
    ['mkv', 'mkv'],
    ['m3u8', 'hls'],
    ['flac', NATIVE_AUDIO_CONTAINER],
  ] as const)('%s → %s', (value, container) => {
    expect(declaredContainer(value)).toBe(container);
  });

  it.each([[undefined], [null], [42], [{}], ['unknown'], ['zzz']])(
    '%s is not a recognisable declaration',
    (value) => {
      expect(declaredContainer(value)).toBeUndefined();
    },
  );
});
