// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SNIFF_WINDOW, rewritePlaylist, sniffPlaylist } from './hls.ts';

describe('sniffPlaylist', () => {
  it.each([
    ['#EXTM3U\n#EXT-X-VERSION:3\n', 'hls'],
    ['\u00ef\u00bb\u00bf#EXTM3U\r\n#EXT-X-STREAM-INF:BANDWIDTH=1\r\n', 'hls'],
    ['  \n#EXTM3U\n#EXTINF:2,\nseg.ts\n#EXT-X-ENDLIST\n', 'hls'],
    ['#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n', 'hls'],
    ['\x47\x40\x00\x10', 'not-hls'],
    ['<html>', 'not-hls'],
    ['{"user_info":{}}', 'not-hls'],
    ['#EXTM3U\n#EXTINF:-1 tvg-id="x",News\nhttp://a.test/1.ts\n', 'undecided'],
    ['#EXT', 'undecided'],
    ['#EXTM3U\n#EXTINF:-1,X-EXT-X-VERSION in a title\n', 'undecided'],
  ])('%j → %s', (prefix, verdict) => {
    expect(sniffPlaylist(prefix, false)).toBe(verdict);
  });

  it('decides an M3U channel list is not HLS when complete or past the window', () => {
    const list = '#EXTM3U\n#EXTINF:-1,News\nhttp://a.test/1.ts\n';
    expect(sniffPlaylist(list, true)).toBe('not-hls');
    expect(sniffPlaylist(list.padEnd(SNIFF_WINDOW, '#'), false)).toBe('not-hls');
    expect(sniffPlaylist('#EXT', true)).toBe('not-hls');
  });

  it('ignores HLS tags after the 64 KiB window', () => {
    const late = `#EXTM3U\n${'#EXTINF:-1,x\n'.repeat(6000)}#EXT-X-VERSION:3\n`;
    expect(late.length).toBeGreaterThan(SNIFF_WINDOW);
    expect(sniffPlaylist(late, true)).toBe('not-hls');
  });
});

describe('rewritePlaylist', () => {
  const base = new URL('http://edge.test/live/ch1/index.m3u8?token=abc');
  const rewrite = (url: string) => `P(${url})`;

  it('rewrites URI lines and URI attributes, resolved against the base', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-MAP:URI="init.mp4",BYTERANGE="100@0"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="x",URI="/audio/a.m3u8"',
      '#EXTINF:2,title with URI="not-a-tag-attr"',
      'seg1.ts?x=1#frag',
      '//cdn.test/seg2.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    expect(rewritePlaylist(input, base, rewrite).split('\n')).toEqual([
      '#EXTM3U',
      '#EXT-X-MAP:URI="P(http://edge.test/live/ch1/init.mp4)",BYTERANGE="100@0"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="x",URI="P(http://edge.test/audio/a.m3u8)"',
      '#EXTINF:2,title with URI="not-a-tag-attr"',
      'P(http://edge.test/live/ch1/seg1.ts?x=1)',
      'P(http://cdn.test/seg2.ts)',
      '#EXT-X-ENDLIST',
    ]);
  });

  it('leaves skd:, data: and other non-http URIs untouched', () => {
    const input =
      '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://k1"\n#EXT-X-KEY:METHOD=AES-128,URI="data:,x"\nrtmp://a.test/x\n';
    expect(rewritePlaylist(input, base, rewrite)).toBe(input);
  });

  it('preserves CRLF, CR, a BOM and the absence of a final newline', () => {
    const input = '\ufeff#EXTM3U\r\n#EXTINF:1,\r\na.ts\rb.ts';
    expect(rewritePlaylist(input, base, rewrite)).toBe(
      '\ufeff#EXTM3U\r\n#EXTINF:1,\r\nP(http://edge.test/live/ch1/a.ts)\rP(http://edge.test/live/ch1/b.ts)',
    );
  });
});
