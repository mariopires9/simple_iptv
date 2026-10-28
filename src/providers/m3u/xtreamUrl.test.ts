// SRC-05 AC2: recognising Xtream `get.php` playlist URLs.
import { describe, expect, it } from 'vitest';
import { detectXtreamPlaylistUrl } from './xtreamUrl';

describe('detectXtreamPlaylistUrl', () => {
  it('extracts server, username and password', () => {
    expect(
      detectXtreamPlaylistUrl(
        ' http://panel.example.test:8080/get.php?username=jdoe&password=p%40ss&type=m3u_plus ',
      ),
    ).toEqual({ server: 'http://panel.example.test:8080', username: 'jdoe', password: 'p@ss' });
  });

  it('keeps a path prefix before get.php', () => {
    expect(
      detectXtreamPlaylistUrl('https://h.example.test/iptv/GET.PHP?username=a&password=b')?.server,
    ).toBe('https://h.example.test/iptv');
  });

  it.each([
    'https://h.example.test/list.m3u?username=a&password=b',
    'https://h.example.test/get.php?username=a',
    'https://h.example.test/get.php?password=b',
    'https://h.example.test/get.php?username=&password=b',
    'javascript:alert(1)',
    'not a url',
  ])('%s → undefined', (url) => {
    expect(detectXtreamPlaylistUrl(url)).toBeUndefined();
  });
});
