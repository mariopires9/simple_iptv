// Persists an M3U-URL source (SRC-05 AC5): the list URL (it often embeds credentials) in the
// credential vault, the source row without it, and the first-run flags (UX-01 AC3) — the same
// steps as the Xtream flow. Also removes such a source when its first import is abandoned.
// Only loaded by the lazy add-source screen (static `@/core/db` / `@/core/crypto` imports are fine).
import { credentialVault } from '@/core/crypto';
import { settingsRepo, sourcesRepo, type Source } from '@/core/db';
import { log } from '@/core/log';
import { forgetActiveSource } from '../activeSource';
import { invalidateSourcesPresence, setSourcesPresent } from '../sourcesPresence';
import { reloadSourcesIfLoaded } from '../sourcesList';
import { MAX_SOURCE_NAME_LENGTH } from '../xtream/saveXtreamSource';

export interface SaveM3uUrlSourceInput {
  /** Optional name typed by the user; empty → `host`. */
  name: string;
  /** Host of the list URL, used as the default name. */
  host: string;
  /** Validated list URL. */
  url: string;
}

/** Vault reference of a source's list URL. */
export const listUrlRef = (sourceId: string) => `source:${sourceId}:url`;

export async function saveM3uUrlSource(input: SaveM3uUrlSourceInput): Promise<Source> {
  const id = crypto.randomUUID();
  const secretRef = listUrlRef(id);
  const name = Array.from(input.name.trim() || input.host)
    .slice(0, MAX_SOURCE_NAME_LENGTH)
    .join('');
  const source: Source = {
    id,
    kind: 'm3u-url',
    name,
    secretRef,
    prefs: { liveFormat: 'auto' },
    createdAt: Date.now(),
    lastSyncStatus: 'never',
    stats: { live: 0, movies: 0, series: 0 },
  };

  await credentialVault.put(secretRef, input.url);
  try {
    await sourcesRepo.put(source);
  } catch (error) {
    await credentialVault.delete(secretRef).catch((cleanup: unknown) => {
      log.warn('Could not remove the secret of an unsaved source', { error: cleanup });
    });
    throw error;
  }
  setSourcesPresent(true);

  try {
    if ((await settingsRepo.get('activeSourceId')) === undefined) {
      await settingsRepo.set('activeSourceId', id);
    }
    await settingsRepo.set('onboardingDone', true);
  } catch (error) {
    log.warn('Could not update the first-run settings', { error });
  }
  // The selector and "My lists" pick up the new list (and the first-run active list).
  forgetActiveSource();
  reloadSourcesIfLoaded();
  log.info('M3U URL source saved', { sourceId: id, https: input.url.startsWith('https:') });
  return source;
}

/** Removes the source, its catalogue and its vault secret ("Delete this list"). */
export async function deleteM3uUrlSource(source: Pick<Source, 'id'>): Promise<void> {
  // One transaction: source row, catalogue, favourites/history and the vault secret (`secretRef`).
  await sourcesRepo.remove(source.id);
  invalidateSourcesPresence();
  forgetActiveSource();
  reloadSourcesIfLoaded();
  log.info('M3U URL source deleted', { sourceId: source.id });
}
