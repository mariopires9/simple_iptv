// VOD-02: `get_vod_info` mapping (tolerant schema; missing/odd fields are omitted).
import { describe, expect, it, vi } from 'vitest';
import { xtreamFixtures } from '@/test/msw';
import { fetchVodInfo, parseVodInfo } from './vodInfo';

describe('parseVodInfo', () => {
  it('maps the full fixture', () => {
    expect(parseVodInfo(xtreamFixtures.vodInfo)).toEqual({
      plot: 'A test pattern discovers it is a movie. Synthetic data for tests.',
      genre: 'Action, Comédia',
      director: 'Carol Placeholder',
      cast: 'Alice Example, Bob Sample, João Exemplo',
      year: 2024,
      rating: 7.1,
      durationSec: 5,
      poster: 'http://img.example.test/posters/2001.jpg',
      backdrop: 'http://img.example.test/backdrops/2001.jpg',
      ext: 'mp4',
    });
  });

  it('an unknown movie (`info: []`, `movie_data: []`) maps to no fields', () => {
    expect(parseVodInfo({ info: [], movie_data: [] })).toEqual({});
    expect(parseVodInfo({})).toEqual({});
  });

  it('omits empty, null and unusable values instead of failing', () => {
    expect(
      parseVodInfo({
        info: {
          name: '',
          plot: null,
          description: '  ',
          genre: 'null',
          rating: '0',
          releasedate: 'unknown',
          duration_secs: '0',
          duration: 'long',
          movie_image: 'javascript:alert(1)',
          cover_big: 42,
          backdrop_path: [],
          director: { nested: true },
        },
        movie_data: { container_extension: '../../x' },
      }),
    ).toEqual({});
  });

  it('accepts numbers as strings, `duration` as h:mm:ss and a single backdrop string', () => {
    expect(
      parseVodInfo({
        info: {
          rating: 8,
          year: 1999,
          duration: '01:42:05',
          backdrop_path: 'https://img.example.test/b.jpg',
          description: 'Fallback plot',
          actors: 'Someone',
        },
        movie_data: { stream_id: 7, container_extension: '.MKV', name: 'Data name' },
      }),
    ).toEqual({
      rating: 8,
      year: 1999,
      durationSec: 6125,
      backdrop: 'https://img.example.test/b.jpg',
      plot: 'Fallback plot',
      cast: 'Someone',
      ext: 'mkv',
    });
  });

  it('keeps markup as plain text and clips very long text', () => {
    const info = parseVodInfo({
      info: { plot: '<img src=x onerror=alert(1)>' + 'a'.repeat(10_000) },
    });
    expect(info?.plot?.startsWith('<img src=x onerror=alert(1)>')).toBe(true);
    expect(info?.plot).toHaveLength(4096);
  });

  it('a body that is not an object is not a VOD info response', () => {
    expect(parseVodInfo('nope')).toBeUndefined();
    expect(parseVodInfo(null)).toBeUndefined();
  });
});

describe('fetchVodInfo', () => {
  it('calls get_vod_info with the vod id and maps the body', async () => {
    const call = vi.fn().mockResolvedValue(xtreamFixtures.vodInfo);
    const info = await fetchVodInfo({ call }, '2001');
    expect(call).toHaveBeenCalledWith('get_vod_info', { vod_id: '2001' }, undefined);
    expect(info.year).toBe(2024);
  });

  it('an unexpected body yields no fields', async () => {
    const call = vi.fn().mockResolvedValue('garbage');
    expect(await fetchVodInfo({ call }, '1')).toEqual({});
  });
});
