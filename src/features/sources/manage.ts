// Changes made from "My lists" (SRC-08): rename, edit an Xtream list's server/credentials, remove
// a list (with the cascade of FND-05 AC4) and pick the next active list.
// Only loaded by lazy screens: static `@/core/db` / `@/core/crypto` imports are fine here.
import { credentialVault } from '@/core/crypto';
import { settingsRepo, sourcesRepo } from '@/core/db';
import { log } from '@/core/log';
import { setActiveSource } from './activeSource';
import { cancelSourceSync } from './sourceSync';
import { setSourcesPresent } from './sourcesPresence';
import { effectiveActiveId, reloadSources, sortSources } from './sourcesList';
import { MAX_SOURCE_NAME_LENGTH, passwordRef } from './xtream/saveXtreamSource';

/** Trimmed and cut by code points (never inside a surrogate pair); empty → `fallback`. */
export function sourceName(name: string, fallback: string): string {
  return Array.from(name.trim() || fallback)
    .slice(0, MAX_SOURCE_NAME_LENGTH)
    .join('');
}

export class SourceNotFoundError extends Error {
  override readonly name = 'SourceNotFoundError';
  constructor() {
    super('Source not found');
  }
}

/** Renames any kind of list. An empty name keeps the current one. */
export async function renameSource(id: string, name: string): Promise<void> {
  const source = await sourcesRepo.get(id);
  if (!source) throw new SourceNotFoundError();
  if (!(await sourcesRepo.update(id, { name: sourceName(name, source.name) }))) {
    throw new SourceNotFoundError();
  }
  await reloadSources().catch(() => undefined);
  log.info('Source renamed', { sourceId: id });
}

export interface UpdateXtreamSourceInput {
  id: string;
  /** Already normalized (see {@link sourceName}). */
  name: string;
  /** Usable base URL from the connection report. */
  serverUrl: string;
  username: string;
  /** New password; `undefined` keeps the stored one. */
  password?: string | undefined;
}

/**
 * Applies a tested Xtream edit (SRC-08 AC2): the new password (if any) to the vault, then the
 * source row. If the row cannot be written, the previous password is put back.
 */
export async function updateXtreamSource(input: UpdateXtreamSourceInput): Promise<void> {
  const source = await sourcesRepo.get(input.id);
  if (source?.kind !== 'xtream') throw new SourceNotFoundError();
  const secretRef = source.secretRef ?? passwordRef(source.id);
  let previous: string | undefined;
  if (input.password !== undefined) {
    previous = await credentialVault.get(secretRef).catch(() => undefined);
    await credentialVault.put(secretRef, input.password);
  }
  try {
    const updated = await sourcesRepo.update(source.id, {
      name: input.name,
      serverUrl: input.serverUrl,
      username: input.username,
      secretRef,
    });
    if (!updated) throw new SourceNotFoundError();
  } catch (error) {
    if (input.password !== undefined) {
      const restore =
        previous !== undefined
          ? credentialVault.put(secretRef, previous)
          : credentialVault.delete(secretRef);
      await restore.catch((cleanup: unknown) => {
        log.warn('Could not restore the previous password', { error: cleanup });
      });
    }
    throw error;
  }
  await reloadSources().catch(() => undefined);
  log.info('Xtream source updated', {
    sourceId: source.id,
    https: input.serverUrl.startsWith('https:'),
    passwordChanged: input.password !== undefined,
  });
}

/** Reads the stored password of an Xtream list (memory only, to re-test an edit). */
export async function readXtreamPassword(sourceId: string): Promise<string | undefined> {
  const source = await sourcesRepo.get(sourceId);
  if (!source) return undefined;
  return credentialVault.get(source.secretRef ?? passwordRef(source.id));
}

export interface RemoveSourceResult {
  /** Lists left after the removal. */
  remaining: number;
  /** The new active list when the removed one was active (`undefined` if none is left). */
  nextActiveId: string | undefined;
  wasActive: boolean;
}

/**
 * Removes a list and everything stored for it (SRC-08 AC3, FND-05 AC4): a running sync of it is
 * cancelled first, then the source row and all its data go in one transaction, and its vault
 * secret is deleted. If it was the active list, the first remaining one (display order) becomes
 * active; the onboarding guard is told whether any list is left.
 */
export async function removeSource(id: string): Promise<RemoveSourceResult> {
  await cancelSourceSync(id);
  const [source, before, storedActive] = await Promise.all([
    sourcesRepo.get(id),
    sourcesRepo.list(),
    settingsRepo.get('activeSourceId'),
  ]);
  const wasActive = effectiveActiveId(before, storedActive) === id;
  await sourcesRepo.remove(id);
  if (source?.secretRef !== undefined) {
    // The cascade already removed the row; this also covers a secret written by another tab.
    await credentialVault.delete(source.secretRef).catch((error: unknown) => {
      log.warn('Could not delete the secret of a removed source', { error });
    });
  }
  const remaining = await sourcesRepo.list();
  setSourcesPresent(remaining.length > 0);
  let nextActiveId: string | undefined;
  if (wasActive) {
    nextActiveId = sortSources(remaining, undefined)[0]?.id;
    await setActiveSource(nextActiveId);
  }
  await reloadSources().catch(() => undefined);
  log.info('Source removed', { sourceId: id, wasActive, remaining: remaining.length });
  return { remaining: remaining.length, nextActiveId, wasActive };
}
