// Review fix 10: one naming rule for adding (Xtream, M3U) and renaming lists.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { wipeAll } from '@/core/db';
import { clearSecrets } from '@/core/log';
import { saveM3uUrlSource } from './m3u/saveM3uUrlSource';
import { MAX_SOURCE_NAME_LENGTH, sourceName } from './sourceName';
import { invalidateSourcesPresence } from './sourcesPresence';
import { saveXtreamSource } from './xtream/saveXtreamSource';

afterEach(async () => {
  invalidateSourcesPresence();
  clearSecrets();
  await wipeAll();
});

const long = `${'a'.repeat(MAX_SOURCE_NAME_LENGTH - 1)}😀😀`;

describe('sourceName', () => {
  it('trims, falls back when empty, cuts by code points (never inside an emoji)', () => {
    expect(sourceName('  Living room  ', 'host')).toBe('Living room');
    expect(sourceName('   ', 'host.example')).toBe('host.example');
    const cut = sourceName(long, 'host');
    expect(Array.from(cut)).toHaveLength(MAX_SOURCE_NAME_LENGTH);
    expect(cut.endsWith('😀')).toBe(true);
  });

  it('both add flows use it', async () => {
    const xtream = await saveXtreamSource({
      name: long,
      host: 'panel.example.test',
      serverUrl: 'http://panel.example.test',
      username: 'u',
      password: 'p',
      lastSyncStatus: 'never',
    });
    const m3u = await saveM3uUrlSource({
      name: '  ',
      host: 'lists.example.test',
      url: 'https://lists.example.test/a.m3u',
    });
    expect(xtream.name).toBe(sourceName(long, 'x'));
    expect(m3u.name).toBe('lists.example.test');
  });
});
