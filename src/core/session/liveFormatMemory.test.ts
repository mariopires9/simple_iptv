// PLY-07 — learned live format per channel and device class: in-memory lookups, debounced
// storage in the `liveFormatMemory` setting, reset per list, capped, and corrupt values ignored.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settingsRepo, wipeAll } from '@/core/db';
import {
  MAX_LEARNED_FORMATS,
  flushLearnedFormats,
  learnedFormat,
  loadLearnedFormats,
  parseLearnedFormats,
  rememberFormat,
  resetLearnedFormats,
  resetLearnedFormatsForTests,
} from './liveFormatMemory';

beforeEach(() => resetLearnedFormatsForTests());
afterEach(async () => {
  resetLearnedFormatsForTests();
  await wipeAll();
});

/** As after reopening the app: memory forgotten, storage kept. */
const reopen = async () => {
  resetLearnedFormatsForTests();
  await loadLearnedFormats();
};

describe('PLY-07 — learned live formats', () => {
  it('remembers synchronously and saves debounced; a later success replaces it', async () => {
    rememberFormat('s1:live:1', 'mse', 'ts');
    expect(learnedFormat('s1:live:1', 'mse')).toBe('ts');
    // Debounced: nothing is written on the play path.
    expect(await settingsRepo.get('liveFormatMemory')).toBeUndefined();
    await flushLearnedFormats();
    // The remembered one failed and the fallback started: the memory follows.
    rememberFormat('s1:live:1', 'mse', 'hls');
    await flushLearnedFormats();
    await reopen();
    expect(learnedFormat('s1:live:1', 'mse')).toBe('hls');
  });

  it('is kept per device class', () => {
    rememberFormat('s1:live:1', 'mse', 'ts');
    expect(learnedFormat('s1:live:1', 'native-hls')).toBeUndefined();
    rememberFormat('s1:live:1', 'native-hls', 'hls');
    expect(learnedFormat('s1:live:1', 'mse')).toBe('ts');
    expect(learnedFormat('s1:live:1', 'native-hls')).toBe('hls');
  });

  it('stores device classes, channel keys and containers only', async () => {
    rememberFormat('s1:live:1', 'native-hls', 'ts');
    await flushLearnedFormats();
    expect(await settingsRepo.get('liveFormatMemory')).toEqual({
      version: 1,
      entries: [['native-hls', 's1:live:1', 'ts']],
    });
  });

  it('reset forgets only the given list, in memory and in storage', async () => {
    rememberFormat('s1:live:1', 'mse', 'ts');
    rememberFormat('s1:live:1', 'native-hls', 'ts');
    rememberFormat('s2:live:1', 'mse', 'hls');
    await resetLearnedFormats('s1');
    expect(learnedFormat('s1:live:1', 'mse')).toBeUndefined();
    expect(learnedFormat('s1:live:1', 'native-hls')).toBeUndefined();
    expect(learnedFormat('s2:live:1', 'mse')).toBe('hls');
    await reopen();
    expect(learnedFormat('s1:live:1', 'mse')).toBeUndefined();
    expect(learnedFormat('s2:live:1', 'mse')).toBe('hls');
  });

  it.each([
    ['not an object', 'garbage'],
    ['another version', { version: 9, entries: [['mse', 's1:live:1', 'ts']] }],
    ['entries not a list', { version: 1, entries: { a: 'ts' } }],
  ])('a corrupt stored value (%s) is ignored', async (_label, stored) => {
    await settingsRepo.set('liveFormatMemory', stored);
    await reopen();
    expect(learnedFormat('s1:live:1', 'mse')).toBeUndefined();
  });

  it('invalid entries are skipped one by one', () => {
    const map = parseLearnedFormats({
      version: 1,
      entries: [
        ['mse', 's1:live:1', 'ts'],
        ['mse', 's1:live:2', 'mp4'],
        ['tv', 's1:live:4', 'ts'],
        ['mse', 42, 'hls'],
        'x',
        ['native-hls', 's1:live:3', 'hls'],
      ],
    });
    expect([...map]).toEqual([
      ['mse|s1:live:1', 'ts'],
      ['native-hls|s1:live:3', 'hls'],
    ]);
  });

  it('keeps at most MAX_LEARNED_FORMATS, evicting the least recently learned', () => {
    for (let i = 0; i <= MAX_LEARNED_FORMATS; i++) rememberFormat(`s1:live:${i}`, 'mse', 'ts');
    expect(learnedFormat('s1:live:0', 'mse')).toBeUndefined();
    expect(learnedFormat('s1:live:1', 'mse')).toBe('ts');
    expect(learnedFormat(`s1:live:${MAX_LEARNED_FORMATS}`, 'mse')).toBe('ts');
  });

  it('formats learned before the stored ones load are kept', async () => {
    await settingsRepo.set('liveFormatMemory', {
      version: 1,
      entries: [['mse', 's1:live:1', 'ts']],
    });
    rememberFormat('s1:live:1', 'mse', 'hls');
    await loadLearnedFormats();
    expect(learnedFormat('s1:live:1', 'mse')).toBe('hls');
  });
});
