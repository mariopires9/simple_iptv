// SRC-08 AC1: card texts — relative time (en / pt-PT), counts per type, status and reasons.
import { describe, expect, it } from 'vitest';
import type { Source } from '@/core/db';
import { messages } from '@/i18n/catalogs';
import {
  describeContents,
  describeLastSync,
  describeStatus,
  formatRelativeTime,
  reasonText,
} from './format';

const en = messages('en');
const pt = messages('pt-PT');
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelativeTime (Intl.RelativeTimeFormat, active locale)', () => {
  it.each([
    [NOW - 10_000, 'now', 'agora'],
    [NOW - 5 * MIN, '5 minutes ago', 'há 5 minutos'],
    [NOW - 2 * HOUR, '2 hours ago', 'há 2 horas'],
    [NOW - DAY, 'yesterday', 'ontem'],
    [NOW - 3 * DAY, '3 days ago', 'há 3 dias'],
    [NOW - 14 * DAY, '2 weeks ago', 'há 2 semanas'],
    [NOW - 400 * DAY, 'last year', 'ano passado'],
  ])('%i → en "%s", pt-PT "%s"', (at, expectedEn, expectedPt) => {
    expect(formatRelativeTime(at, NOW, 'en')).toBe(expectedEn);
    expect(formatRelativeTime(at, NOW, 'pt-PT')).toBe(expectedPt);
  });

  it('a timestamp in the future (clock moved) reads as "in …", not as a negative age', () => {
    expect(formatRelativeTime(NOW + 2 * HOUR, NOW, 'en')).toBe('in 2 hours');
  });
});

const base: Source = {
  id: 's',
  kind: 'xtream',
  name: 'Living room',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 1234, movies: 8900, series: 410 },
};

describe('describeContents', () => {
  it('Xtream: type and the three counts, localized numbers', () => {
    expect(describeContents(base, en, 'en')).toBe(
      'Xtream · 1,234 channels · 8,900 movies · 410 series',
    );
    expect(describeContents(base, pt, 'pt-PT')).toMatch(
      /^Xtream · 1\s?234 canais · 8\s?900 filmes · 410 séries$/,
    );
  });

  it('M3U (URL): channels only unless the list has VOD entries; singular forms', () => {
    const m3u: Source = { ...base, kind: 'm3u-url', stats: { live: 1, movies: 0, series: 0 } };
    expect(describeContents(m3u, en, 'en')).toBe('M3U (URL) · 1 channel');
    expect(describeContents({ ...m3u, stats: { live: 3, movies: 1, series: 0 } }, en, 'en')).toBe(
      'M3U (URL) · 3 channels · 1 movie',
    );
    expect(describeContents(m3u, pt, 'pt-PT')).toBe('M3U (URL) · 1 canal');
  });

  it('M3U (file)', () => {
    const file: Source = { ...base, kind: 'm3u-file', stats: { live: 95, movies: 0, series: 0 } };
    expect(describeContents(file, en, 'en')).toBe('M3U (file) · 95 channels');
    expect(describeContents(file, pt, 'pt-PT')).toBe('M3U (ficheiro) · 95 canais');
  });
});

describe('describeLastSync', () => {
  it('relative time when synced, "never" otherwise', () => {
    expect(describeLastSync({ lastSyncAt: NOW - 2 * HOUR }, NOW, en, 'en')).toBe(
      'Updated 2 hours ago',
    );
    expect(describeLastSync({ lastSyncAt: NOW - DAY }, NOW, pt, 'pt-PT')).toBe('Atualizada ontem');
    expect(describeLastSync({}, NOW, en, 'en')).toBe('Never updated');
  });
});

describe('describeStatus', () => {
  it('ok / never / syncing', () => {
    expect(describeStatus(base, en, 'en')).toEqual({ tone: 'ok', text: 'Up to date' });
    expect(describeStatus({ ...base, lastSyncStatus: 'never' }, en, 'en')).toEqual({
      tone: 'neutral',
      text: 'Not loaded yet',
    });
    expect(describeStatus({ ...base, lastSyncStatus: 'syncing' }, pt, 'pt-PT').text).toBe(
      'A atualizar…',
    );
  });

  it('partial: names the failed types and the reason from lastSyncByType', () => {
    const partial: Source = {
      ...base,
      lastSyncStatus: 'partial',
      lastSyncError: 'timeout',
      lastSyncByType: {
        live: { status: 'ok', at: NOW },
        movie: { status: 'error', at: NOW, error: 'timeout' },
        series: { status: 'error', at: NOW, error: 'http', httpStatus: 500 },
      },
    };
    expect(describeStatus(partial, en, 'en')).toEqual({
      tone: 'warning',
      text: 'Some content was not updated (movies and series): the server took too long',
    });
    expect(describeStatus(partial, pt, 'pt-PT').text).toBe(
      'Parte do conteúdo não foi atualizada (filmes e séries): o servidor demorou demasiado',
    );
  });

  it('error: the reason from lastSyncError (M3U and Xtream codes)', () => {
    expect(
      describeStatus({ ...base, lastSyncStatus: 'error', lastSyncError: 'not-m3u' }, en, 'en'),
    ).toEqual({ tone: 'error', text: 'Update failed: not an M3U list' });
    expect(
      describeStatus({ ...base, lastSyncStatus: 'error', lastSyncError: 'auth' }, pt, 'pt-PT').text,
    ).toBe('A atualização falhou: acesso recusado');
    // Saved despite a failed connection test (SRC-03 "Save anyway").
    expect(
      describeStatus(
        { ...base, lastSyncStatus: 'error', lastSyncError: 'blocked-mixed-content' },
        en,
        'en',
      ).text,
    ).toBe('Update failed: insecure (HTTP) server address');
  });

  it('unknown or missing codes fall back to a generic reason (never the raw code)', () => {
    expect(reasonText('something-new', en)).toBe('unknown error');
    expect(reasonText(undefined, en)).toBe('unknown error');
    expect(reasonText('toString', en)).toBe('unknown error');
  });
});
