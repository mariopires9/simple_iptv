// LIV-02 / PLY-06: the Xtream live stream address (built in memory only).
import { describe, expect, it } from 'vitest';
import { xtreamLiveStreamUrl, xtreamStreamId } from './streamUrl';

describe('xtreamLiveStreamUrl', () => {
  it('builds /live/<user>/<pass>/<id>.<ext>, encoding each part', () => {
    expect(xtreamLiveStreamUrl('https://panel.example.test/', 'jdoe', 'p/ss w', '42', 'ts')).toBe(
      'https://panel.example.test/live/jdoe/p%2Fss%20w/42.ts',
    );
    expect(xtreamLiveStreamUrl('http://h.test:8080//', 'u', 'p', '7', 'm3u8')).toBe(
      'http://h.test:8080/live/u/p/7.m3u8',
    );
  });

  it('stream ids tolerate an extension left by older catalogues', () => {
    expect(xtreamStreamId('42.ts')).toBe('42');
    expect(xtreamStreamId('42')).toBe('42');
  });
});
