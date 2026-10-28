#!/usr/bin/env bash
# Regenerates the synthetic test streams in fixtures/streams (QA-01).
#
# Every file is produced from ffmpeg's built-in test sources (testsrc2 video,
# sine audio) — no third-party media is involved. Output is licensed CC0
# (see fixtures/streams/README.md).
#
# ffmpeg resolution order:
#   1. $FFMPEG (path to an ffmpeg binary)
#   2. `ffmpeg` on PATH
#   3. the `ffmpeg-static` npm package installed into a throwaway temp dir
#      (it is NOT a project dependency; `npx ffmpeg-static` does not work
#      because the package exposes no bin entry)
#
# Usage: scripts/fixtures/generate-streams.sh [out-dir]   (default: fixtures/streams)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT/fixtures/streams}"

if [[ -n "${FFMPEG:-}" ]]; then
  :
elif command -v ffmpeg >/dev/null 2>&1; then
  FFMPEG="$(command -v ffmpeg)"
else
  TMP_FFMPEG="$(mktemp -d)"
  trap 'rm -rf "$TMP_FFMPEG"' EXIT
  echo "ffmpeg not found; installing ffmpeg-static into $TMP_FFMPEG" >&2
  npm install --silent --no-save --no-package-lock --prefix "$TMP_FFMPEG" ffmpeg-static >&2
  FFMPEG="$(cd "$TMP_FFMPEG" && node -p "require('ffmpeg-static')")"
fi
echo "using $FFMPEG" >&2

# Shared settings: 320x180 @ 25 fps, 5 s, keyframe every 2 s, low bitrate,
# H.264 Main 3.0 (avc1.4d401e) + AAC-LC 64 kb/s mono (mp4a.40.2).
DUR=5
FF=("$FFMPEG" -hide_banner -loglevel error -y)
VIDEO_IN=(-f lavfi -i "testsrc2=size=320x180:rate=25:duration=$DUR")
sine_in() {
  SINE_IN=(-f lavfi -i "sine=frequency=$1:sample_rate=48000:duration=$DUR")
}
VENC=(-c:v libx264 -preset veryfast -profile:v main -level:v 3.0 -pix_fmt yuv420p
  -b:v 120k -maxrate 150k -bufsize 300k -g 50 -keyint_min 50 -sc_threshold 0
  -threads 1 -flags:v +bitexact)
AENC=(-c:a aac -b:a 64k -ac 1 -ar 48000 -flags:a +bitexact)
META=(-fflags +bitexact -map_metadata -1)

rm -rf "$OUT/hls" "$OUT/hls-multi" "$OUT/ts" "$OUT/mp4"
mkdir -p "$OUT/hls" "$OUT/hls-multi/subs" "$OUT/ts" "$OUT/mp4"

# 1. HLS VOD, H.264/AAC, 2 s MPEG-TS segments.
sine_in 440
"${FF[@]}" "${VIDEO_IN[@]}" "${SINE_IN[@]}" -map 0:v -map 1:a "${VENC[@]}" "${AENC[@]}" "${META[@]}" \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_flags independent_segments \
  -hls_segment_filename "$OUT/hls/seg%02d.ts" "$OUT/hls/index.m3u8"

# 2. HLS with alternate audio renditions (en = 440 Hz, pt = 660 Hz) and a
#    WebVTT subtitle rendition. Media playlists come from ffmpeg; the master
#    playlist and the subtitle playlist are written by hand below.
"${FF[@]}" "${VIDEO_IN[@]}" -map 0:v "${VENC[@]}" "${META[@]}" \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_flags independent_segments \
  -hls_segment_filename "$OUT/hls-multi/video_%02d.ts" "$OUT/hls-multi/video.m3u8"
for pair in en:440 pt:660; do
  lang="${pair%%:*}"
  sine_in "${pair##*:}"
  "${FF[@]}" "${SINE_IN[@]}" -map 0:a "${AENC[@]}" "${META[@]}" \
    -f hls -hls_time 2 -hls_playlist_type vod \
    -hls_segment_filename "$OUT/hls-multi/audio_${lang}_%02d.ts" "$OUT/hls-multi/audio_${lang}.m3u8"
done
cat >"$OUT/hls-multi/subs/en.vtt" <<'VTT'
WEBVTT
X-TIMESTAMP-MAP=MPEGTS:126000,LOCAL:00:00:00.000

00:00:00.000 --> 00:00:02.000
Synthetic subtitle one

00:00:02.000 --> 00:00:05.000
Synthetic subtitle two
VTT
cat >"$OUT/hls-multi/subs/en.m3u8" <<'M3U8'
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:5
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:5.000,
en.vtt
#EXT-X-ENDLIST
M3U8
cat >"$OUT/hls-multi/master.m3u8" <<'M3U8'
#EXTM3U
#EXT-X-VERSION:4
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="1",URI="audio_en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Português",LANGUAGE="pt",DEFAULT=NO,AUTOSELECT=YES,CHANNELS="1",URI="audio_pt.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,URI="subs/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=260000,AVERAGE-BANDWIDTH=200000,RESOLUTION=320x180,FRAME-RATE=25.000,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"
video.m3u8
M3U8

# 3. MPEG-TS, H.264/AAC (what an Xtream live `.ts` URL returns).
sine_in 440
"${FF[@]}" "${VIDEO_IN[@]}" "${SINE_IN[@]}" -map 0:v -map 1:a "${VENC[@]}" "${AENC[@]}" "${META[@]}" \
  -f mpegts "$OUT/ts/h264-aac.ts"

# 4. MPEG-TS, H.264/AC-3 (audio codec unsupported by MSE in most browsers).
"${FF[@]}" "${VIDEO_IN[@]}" "${SINE_IN[@]}" -map 0:v -map 1:a "${VENC[@]}" \
  -c:a ac3 -b:a 96k -ac 2 -ar 48000 -flags:a +bitexact "${META[@]}" \
  -f mpegts "$OUT/ts/h264-ac3.ts"

# 5. Progressive MP4 with faststart (moov before mdat), H.264/AAC.
"${FF[@]}" "${VIDEO_IN[@]}" "${SINE_IN[@]}" -map 0:v -map 1:a "${VENC[@]}" "${AENC[@]}" "${META[@]}" \
  -movflags +faststart -f mp4 "$OUT/mp4/h264-aac.mp4"

du -ab "$OUT" | sort -n >&2
