// SRC-06: the saved file source — no URL, nothing in the vault, a name from the user, the file name
// or (localized) a default.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { sourcesRepo, wipeAll } from '@/core/db';
import { t } from '@/i18n';
import { invalidateSourcesPresence } from '../sourcesPresence';
import { fileBaseName, saveM3uFileSource } from './saveM3uFileSource';

afterEach(async () => {
  invalidateSourcesPresence();
  await wipeAll();
});

describe('saveM3uFileSource', () => {
  it('stores an m3u-file source without URL or secret', async () => {
    const source = await saveM3uFileSource({ name: '', fileName: 'Kitchen TV.m3u8' });
    expect(source).toMatchObject({ kind: 'm3u-file', name: 'Kitchen TV', lastSyncStatus: 'never' });
    expect(source.secretRef).toBeUndefined();
    expect(source.serverUrl).toBeUndefined();
    expect(await sourcesRepo.get(source.id)).toEqual(source);
  });

  it('a typed name wins; without any name the localized default is used', async () => {
    expect((await saveM3uFileSource({ name: ' Mine ', fileName: 'x.m3u' })).name).toBe('Mine');
    expect((await saveM3uFileSource({ name: '', fileName: '' })).name).toBe(
      t.sources.addM3uFile.fields.defaultName,
    );
  });

  it('fileBaseName drops the playlist extension only', () => {
    expect(fileBaseName('list.M3U')).toBe('list');
    expect(fileBaseName('my.list.m3u8')).toBe('my.list');
    expect(fileBaseName('.m3u')).toBe('.m3u');
    expect(fileBaseName('notes.pdf')).toBe('notes.pdf');
  });
});
