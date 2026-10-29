// Human-readable names of codecs and containers for playback messages (PLY-04 AC2/AC3).
// These are technical proper names (identical in every locale), so they live here as data and
// are interpolated into the localized messages of `src/i18n/<locale>/player.ts`.
import type { StreamContainer } from '../types';

/** RFC 6381 codec string → display name. First match wins. */
const CODEC_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^avc[13](\.|$)/i, 'H.264'],
  [/^(hvc1|hev1)(\.|$)/i, 'HEVC (H.265)'],
  [/^(vp09|vp9)(\.|$)/i, 'VP9'],
  [/^vp8$/i, 'VP8'],
  [/^av01(\.|$)/i, 'AV1'],
  [/^(ac-3|mp4a\.a5)$/i, 'AC-3 (Dolby Digital)'],
  [/^(ec-3|mp4a\.a6)$/i, 'E-AC-3 (Dolby Digital Plus)'],
  [/^ac-4(\.|$)/i, 'AC-4 (Dolby)'],
  [/^(mp3|mp4a\.40\.34)$/i, 'MP3'],
  [/^(mp4a\.69|mp4a\.6b)$/i, 'MPEG audio (MP2/MP3)'],
  [/^mp4a\.40(\.|$)/i, 'AAC'],
  [/^opus$/i, 'Opus'],
  [/^flac$/i, 'FLAC'],
];

/** `avc1.64001f, ac-3` → `H.264, AC-3 (Dolby Digital)`; unknown codecs are kept as given. */
export function formatCodecs(codecs: string): string {
  const names = codecs
    .split(',')
    .map((codec) => codec.trim())
    .filter((codec) => codec !== '')
    .map((codec) => CODEC_NAMES.find(([pattern]) => pattern.test(codec))?.[1] ?? codec);
  return [...new Set(names)].join(', ');
}

const CONTAINER_NAMES: Readonly<Record<StreamContainer, string | undefined>> = {
  hls: 'HLS',
  ts: 'MPEG-TS',
  mp4: 'MP4',
  mkv: 'MKV',
  webm: 'WebM',
  mov: 'MOV',
  flv: 'FLV',
  avi: 'AVI',
  unknown: undefined,
};

/** Display name of a stream container, or undefined when it is not known. */
export function containerName(container: string): string | undefined {
  return Object.hasOwn(CONTAINER_NAMES, container)
    ? CONTAINER_NAMES[container as StreamContainer]
    : undefined;
}
