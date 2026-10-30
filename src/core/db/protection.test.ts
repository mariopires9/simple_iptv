// @vitest-environment node
// UX-07: which items are protected content (DRM-flagged or DASH).
import { describe, expect, it } from 'vitest';
import { isProtectedItem, isProtectedStream } from './protection';
import type { Channel, Movie, Series } from './types';

const channel = (extra: Partial<Channel> = {}): Channel => ({
  key: 's:live:1',
  sourceId: 's',
  type: 'live',
  externalId: '1',
  name: 'One',
  nameNorm: 'one',
  order: 0,
  streamPath: '',
  ...extra,
});
const movie = (extra: Partial<Movie> = {}): Movie => ({
  key: 's:movie:1',
  sourceId: 's',
  type: 'movie',
  externalId: '1',
  name: 'Film',
  order: 0,
  streamPath: '',
  ...extra,
});
const series = (extra: Partial<Series> = {}): Series => ({
  key: 's:series:1',
  sourceId: 's',
  type: 'series',
  externalId: '1',
  name: 'Show',
  order: 0,
  ...extra,
});

describe('protected content (UX-07)', () => {
  it('a stream is protected when DRM-flagged or DASH', () => {
    expect(isProtectedStream({})).toBe(false);
    expect(isProtectedStream({ drm: true })).toBe(true);
    expect(isProtectedStream({ drm: false, container: 'dash' })).toBe(true);
    expect(isProtectedStream({ container: 'hls' })).toBe(false);
    // Like the player's refusal: any truthy DRM value, and an undeclared `.mpd` URL.
    expect(isProtectedStream({ drm: { system: 'widevine' } })).toBe(true);
    expect(isProtectedStream({ streamUrl: 'https://cdn.example.test/a.mpd?t=1' })).toBe(true);
    expect(isProtectedStream({ streamUrl: 'https://cdn.example.test/a.m3u8' })).toBe(false);
    expect(
      isProtectedStream({ streamUrl: 'https://cdn.example.test/a.mpd', container: 'hls' }),
    ).toBe(false);
  });

  it('agrees with the player: the URL path only, and an unrecognised container falls back to it', () => {
    // A query naming an .mpd file is not DASH (the player plays the path, play.php).
    expect(isProtectedStream({ streamUrl: 'https://cdn.example.test/play.php?src=feed.mpd' })).toBe(
      false,
    );
    // A legacy/unknown declared container: the URL decides (as in the player).
    expect(
      isProtectedStream({ container: 'legacy', streamUrl: 'https://cdn.example.test/a.mpd' }),
    ).toBe(true);
    expect(
      isProtectedStream({ container: 'legacy', streamUrl: 'https://cdn.example.test/a.ts' }),
    ).toBe(false);
    expect(isProtectedStream({ container: 'DASH' })).toBe(true);
    expect(isProtectedStream({ streamUrl: 'not a url .mpd' })).toBe(false);
  });

  it('channels, movies and single-entry series follow their own stream flags', () => {
    expect(isProtectedItem(channel())).toBe(false);
    expect(isProtectedItem(channel({ drm: true }))).toBe(true);
    expect(isProtectedItem(movie({ container: 'dash' }))).toBe(true);
    expect(isProtectedItem(movie({ container: 'mp4' }))).toBe(false);
    expect(isProtectedItem(series({ drm: true }))).toBe(true);
  });

  it('a grouped series is protected when flagged at import (every episode protected)', () => {
    expect(isProtectedItem(series())).toBe(false);
    expect(isProtectedItem(series({ allEpisodesProtected: true }))).toBe(true);
  });
});
