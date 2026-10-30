// PLY-06 B: what the first bytes of a stream say — playlists with http:// URIs or HEVC CODECS,
// MPEG-TS with an HEVC program map, error pages.
import { describe, expect, it } from 'vitest';
import { sniffContent, sniffPlaylist } from './sniff';
import { H264_AAC, HEVC_AAC, tsWithStreamTypes } from './test-utils/fakes';

const BASE = 'https://cdn.example.test/live/u/p/1.m3u8';
const bytes = (text: string) => new TextEncoder().encode(text);

describe('sniffPlaylist', () => {
  it('counts http:// segment URIs', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'http://10.0.0.1:8080/hls/seg1.ts',
      '#EXTINF:10,',
      'http://10.0.0.1:8080/hls/seg2.ts',
    ].join('\n');
    expect(sniffPlaylist(playlist, BASE)).toEqual({ type: 'playlist', httpUris: 2, hevc: false });
  });

  it('resolves relative URIs against the final address', () => {
    const playlist = '#EXTM3U\n#EXTINF:10,\nseg1.ts\n';
    expect(sniffPlaylist(playlist, BASE)).toMatchObject({ httpUris: 0 });
    expect(sniffPlaylist(playlist, 'http://cdn.example.test/1.m3u8')).toMatchObject({
      httpUris: 1,
    });
  });

  it('counts http:// URIs in attributes (keys, media) and variant URIs', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="http://cdn.example.test/a.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.64001f,mp4a.40.2"',
      'http://cdn.example.test/720.m3u8',
    ].join('\r\n');
    expect(sniffPlaylist(playlist, BASE)).toEqual({
      type: 'playlist',
      httpUris: 2,
      hevc: false,
      variant: 'http://cdn.example.test/720.m3u8',
    });
  });

  it.each(['hvc1.1.6.L120.90', 'hev1.2.4.L120.B0'])('detects HEVC in CODECS (%s)', (codec) => {
    const playlist = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="${codec},mp4a.40.2"\nv.m3u8\n`;
    expect(sniffPlaylist(playlist, BASE)).toMatchObject({ hevc: true, httpUris: 0 });
  });

  it('https segments are fine', () => {
    expect(sniffPlaylist('#EXTM3U\n#EXTINF:10,\nhttps://cdn.example.test/s.ts', BASE)).toEqual({
      type: 'playlist',
      httpUris: 0,
      hevc: false,
    });
  });
});

describe('sniffContent', () => {
  it('MPEG-TS with H.264: no HEVC', () => {
    expect(sniffContent(tsWithStreamTypes(H264_AAC), BASE)).toEqual({ type: 'ts', hevc: false });
  });

  it('MPEG-TS with HEVC in the program map', () => {
    expect(sniffContent(tsWithStreamTypes(HEVC_AAC), BASE)).toEqual({ type: 'ts', hevc: true });
  });

  it('a playlist (with a BOM and leading blank lines)', () => {
    expect(sniffContent(bytes('\uFEFF\n#EXTM3U\n#EXTINF:1,\nhttp://h.test/1.ts'), BASE)).toEqual({
      type: 'playlist',
      httpUris: 1,
      hevc: false,
    });
  });

  it('a master playlist keeps its first variant, resolved', () => {
    const playlist =
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\nhi.m3u8';
    expect(sniffPlaylist(playlist, BASE)).toMatchObject({
      variant: 'https://cdn.example.test/live/u/p/low/index.m3u8',
    });
    expect(sniffPlaylist('#EXTM3U\n#EXTINF:1,\nseg.ts', BASE)).not.toHaveProperty('variant');
  });

  it('other media containers are "media"', () => {
    const mp4 = new Uint8Array([0, 0, 0, 0x20, ...bytes('ftypisom')]);
    expect(sniffContent(mp4, BASE)).toEqual({ type: 'media' });
    expect(sniffContent(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]), BASE)).toEqual({
      type: 'media',
    });
    expect(sniffContent(bytes('FLV\x01'), BASE)).toEqual({ type: 'media' });
  });

  it('an HTML or JSON answer is "text"; nothing is "empty"', () => {
    expect(sniffContent(bytes('<!doctype html><title>404</title>'), BASE)).toEqual({
      type: 'text',
    });
    expect(sniffContent(bytes('{"user_info":{"auth":0}}'), BASE)).toEqual({ type: 'text' });
    expect(sniffContent(new Uint8Array(0), BASE)).toEqual({ type: 'empty' });
  });

  it('truncated or garbage TS does not throw', () => {
    const garbage = new Uint8Array(400).fill(0x47);
    expect(() => sniffContent(garbage, BASE)).not.toThrow();
    expect(sniffContent(tsWithStreamTypes(HEVC_AAC).subarray(0, 200), BASE)).toMatchObject({
      type: 'ts',
    });
  });
});
