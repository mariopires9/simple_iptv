import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { wipeAll } from '@/core/db';
import { clearSecrets } from '@/core/log';
import { invalidateSourcesPresence } from '../sourcesPresence';
import { MAX_SOURCE_NAME_LENGTH, saveXtreamSource } from './saveXtreamSource';

afterEach(async () => {
  invalidateSourcesPresence();
  clearSecrets();
  await wipeAll();
});

const input = (name: string) => ({
  name,
  host: 'panel.example.test',
  serverUrl: 'http://panel.example.test:8080',
  username: 'jdoe',
  password: 'testpass',
  lastSyncStatus: 'never' as const,
});

describe('saveXtreamSource — name truncation (review finding 6)', () => {
  it('cuts by code points: an emoji at the boundary is kept whole, never split', async () => {
    const name = `${'a'.repeat(MAX_SOURCE_NAME_LENGTH - 1)}📺📺`;
    const source = await saveXtreamSource(input(name));
    expect(Array.from(source.name)).toHaveLength(MAX_SOURCE_NAME_LENGTH);
    expect(source.name.endsWith('📺')).toBe(true);
    expect(source.name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // no lone surrogate
  });

  it('an empty name falls back to the host', async () => {
    expect((await saveXtreamSource(input('   '))).name).toBe('panel.example.test');
  });
});
