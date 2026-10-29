// Persists a local-M3U-file source (SRC-06): only the source row — there is no URL and nothing
// secret to put in the vault, and the file itself is never stored (the worker keeps only the
// parsed catalogue). Then the same first-run steps as the other kinds of list (UX-01 AC3).
// Only loaded by the lazy add-source screen (static `@/core/db` imports are fine).
import { sourcesRepo, type Source } from '@/core/db';
import { log } from '@/core/log';
import { sourceName } from '../sourceName';
import { afterSourceSaved } from './saveM3uUrlSource';

export interface SaveM3uFileSourceInput {
  /** Optional name typed by the user; empty → the file name without its extension. */
  name: string;
  /** Name of the picked file (only used for the default list name). */
  fileName: string;
}

/** `my list.m3u8` → `my list`; a name that is only an extension is kept as is. */
export function fileBaseName(fileName: string): string {
  const base = fileName.replace(/\.(m3u8?|txt)$/i, '').trim();
  return base === '' ? fileName.trim() : base;
}

export async function saveM3uFileSource(input: SaveM3uFileSourceInput): Promise<Source> {
  const id = crypto.randomUUID();
  const source: Source = {
    id,
    kind: 'm3u-file',
    name: sourceName(input.name, fileBaseName(input.fileName) || 'M3U'),
    prefs: { liveFormat: 'auto' },
    createdAt: Date.now(),
    lastSyncStatus: 'never',
    stats: { live: 0, movies: 0, series: 0 },
  };
  await sourcesRepo.put(source);
  await afterSourceSaved(id);
  log.info('M3U file source saved', { sourceId: id });
  return source;
}
