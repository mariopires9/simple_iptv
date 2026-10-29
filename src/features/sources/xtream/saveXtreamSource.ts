// Persists a tested Xtream source (SRC-03 AC2): password in the credential vault, the source row
// without any secret, and the first-run flags (UX-01 AC3).
// Only loaded by the lazy add-source screen: static `@/core/db` / `@/core/crypto` imports are fine
// here (they never reach the initial bundle).
import { credentialVault } from '@/core/crypto';
import { settingsRepo, sourcesRepo, type Source, type SyncStatus } from '@/core/db';
import { log } from '@/core/log';
import { forgetActiveSource } from '../activeSource';
import { setSourcesPresent } from '../sourcesPresence';
import { reloadSourcesIfLoaded } from '../sourcesList';

/** Maximum length of a source name, in code points (docs/SECURITY.md §3: names are truncated). */
export const MAX_SOURCE_NAME_LENGTH = 512;

export interface SaveXtreamSourceInput {
  /** Optional name typed by the user; empty → `host`. */
  name: string;
  /** Host the user entered, used as the default name. */
  host: string;
  /** Usable base URL from the connection report (may be the HTTPS one). */
  serverUrl: string;
  username: string;
  password: string;
  /** `'never'` after a successful test; `'error'` when saved despite a failed test. */
  lastSyncStatus: Extract<SyncStatus, 'never' | 'error'>;
  /** Problem code of the failed test, with `lastSyncStatus: 'error'` (never sensitive). */
  lastSyncError?: string;
}

/** Vault reference of a source's password. */
export const passwordRef = (sourceId: string) => `source:${sourceId}:password`;

export async function saveXtreamSource(input: SaveXtreamSourceInput): Promise<Source> {
  const id = crypto.randomUUID();
  const secretRef = passwordRef(id);
  // Cut by code points, never inside a surrogate pair (an emoji at the boundary).
  const name = Array.from(input.name.trim() || input.host)
    .slice(0, MAX_SOURCE_NAME_LENGTH)
    .join('');
  const source: Source = {
    id,
    kind: 'xtream',
    name,
    serverUrl: input.serverUrl,
    username: input.username,
    secretRef,
    prefs: { liveFormat: 'auto' },
    createdAt: Date.now(),
    lastSyncStatus: input.lastSyncStatus,
    stats: { live: 0, movies: 0, series: 0 },
  };
  if (input.lastSyncError !== undefined) source.lastSyncError = input.lastSyncError;

  await credentialVault.put(secretRef, input.password);
  try {
    await sourcesRepo.put(source);
  } catch (error) {
    // Do not leave an orphan secret behind.
    await credentialVault.delete(secretRef).catch((cleanup: unknown) => {
      log.warn('Could not remove the secret of an unsaved source', { error: cleanup });
    });
    throw error;
  }
  setSourcesPresent(true);

  // First-run flags: failures here must not undo the saved source.
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
  log.info('Xtream source saved', { sourceId: id, https: source.serverUrl?.startsWith('https:') });
  return source;
}
