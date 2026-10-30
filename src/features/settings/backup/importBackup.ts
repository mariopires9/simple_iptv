// Settings › Backup — import (EXP-01): reads a picked file (./format validates it), previews it,
// then writes it in `merge` or `replace` mode. Imported secrets go into the vault (encrypted with
// this device's key); catalogue data is not in the file, so the imported lists are queued for a
// sync (`markSourcesForSync`) that the restarted app runs.
//
// - merge: the device's lists, favorites and history stay. A list already here (same id) gets the
//   file's configuration and keeps its catalogue and, when the file has none, its secret;
//   favorites already here are kept; for history the newer entry wins. Settings in the file apply.
// - replace: every list on the device is removed first (with its catalogue, favorites, history and
//   secret — `sourcesRepo.remove`), the personal proxy too, and the backed-up settings absent from
//   the file go back to their defaults.
// A wrong password is detected before anything is written.
import { credentialVault, decryptWithPassword, PasswordDecryptError } from '@/core/crypto';
import {
  favoritesRepo,
  historyRepo,
  settingsRepo,
  sourcesRepo,
  type Favorite,
  type HistoryEntry,
  type Source,
} from '@/core/db';
import { log, registerSecret } from '@/core/log';
import { isValidProxyToken } from '@/core/net';
import { markSourcesForSync, removePersonalProxy, savePersonalProxy } from '@/core/session';
import * as v from 'valibot';
import {
  BACKUP_AAD,
  BACKUP_BOOLEAN_SETTINGS,
  BACKUP_SETTING_KEYS,
  BackupFileError,
  MAX_BACKUP_BYTES,
  parseBackup,
  SecretsSchema,
  type BackupSecrets,
  type BackupSource,
  type ParsedBackup,
} from './format';

export type ImportMode = 'merge' | 'replace';

/** Reads a picked file (size checked before reading). Throws `BackupFileError`. */
export async function readBackupFile(file: Blob): Promise<ParsedBackup> {
  if (file.size > MAX_BACKUP_BYTES) throw new BackupFileError('too-large');
  return parseBackup(await file.text());
}

export interface BackupPreview {
  sources: number;
  favorites: number;
  history: number;
  /** Settings carried by the file (theme, language, playback, proxy address, active list). */
  settings: number;
  encrypted: boolean;
  /** Lists whose secret the encrypted part holds. */
  sourceSecrets: number;
  proxyToken: boolean;
  skipped: number;
}

export function previewBackup(backup: ParsedBackup): BackupPreview {
  return {
    sources: backup.sources.length,
    favorites: backup.favorites.length,
    history: backup.history.length,
    settings: Object.keys(backup.settings).length,
    encrypted: backup.secrets !== undefined,
    sourceSecrets: backup.secretsIncluded.sources.length,
    proxyToken: backup.secretsIncluded.proxyToken,
    skipped: backup.skipped,
  };
}

/** The password does not open the file's secrets (or they were altered). */
export class WrongBackupPasswordError extends Error {
  override readonly name = 'WrongBackupPasswordError';
  constructor(options?: { cause?: unknown }) {
    super('Wrong backup password or damaged secrets', options);
  }
}

/**
 * Decrypts and validates the secrets. No password (or a file without secrets): none.
 * Throws {@link WrongBackupPasswordError}.
 */
export async function unlockSecrets(
  backup: ParsedBackup,
  password: string | undefined,
): Promise<BackupSecrets> {
  if (!backup.secrets || password === undefined || password === '') return { sources: {} };
  let text: string;
  try {
    text = await decryptWithPassword(backup.secrets, password, { aad: BACKUP_AAD });
  } catch (error) {
    if (error instanceof PasswordDecryptError) throw new WrongBackupPasswordError({ cause: error });
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new WrongBackupPasswordError({ cause: error });
  }
  const parsed = v.safeParse(SecretsSchema, json);
  if (!parsed.success) throw new WrongBackupPasswordError();
  const secrets: BackupSecrets = { sources: { ...parsed.output.sources } };
  for (const secret of Object.values(secrets.sources)) registerSecret(secret);
  const token = parsed.output.proxyToken;
  if (token !== undefined && isValidProxyToken(token)) {
    registerSecret(token);
    secrets.proxyToken = token;
  }
  return secrets;
}

export interface ImportResult {
  /** Lists written. */
  sources: number;
  /** Lists left out (an M3U-URL list without its address: nothing to use). */
  skippedSources: number;
  /** Lists written without a secret (Xtream: the password must be entered again). */
  missingSecrets: number;
  favorites: number;
  history: number;
  /** Lists queued for a sync after the restart. */
  queuedForSync: number;
}

const vaultRef = (source: BackupSource) =>
  `source:${source.id}:${source.kind === 'xtream' ? 'password' : 'url'}`;

function toSource(backup: BackupSource, existing: Source | undefined, secretRef?: string): Source {
  const prefs: Source['prefs'] = { liveFormat: backup.prefs.liveFormat };
  if (backup.prefs.proxy !== undefined && backup.prefs.proxy !== 'off') {
    prefs.proxy = backup.prefs.proxy;
  }
  const base: Source = existing
    ? { ...existing }
    : {
        id: backup.id,
        kind: backup.kind,
        name: backup.name,
        prefs,
        createdAt: backup.createdAt || Date.now(),
        lastSyncStatus: 'never',
        stats: { live: 0, movies: 0, series: 0 },
      };
  const out: Source = { ...base, kind: backup.kind, name: backup.name, prefs };
  delete out.serverUrl;
  delete out.username;
  delete out.epgUrl;
  delete out.epgUrls;
  delete out.secretRef;
  if (backup.serverUrl !== undefined) out.serverUrl = backup.serverUrl;
  if (backup.username !== undefined) out.username = backup.username;
  if (backup.epgUrl !== undefined) out.epgUrl = backup.epgUrl;
  if (backup.epgUrls !== undefined) out.epgUrls = backup.epgUrls;
  if (secretRef !== undefined) out.secretRef = secretRef;
  return out;
}

async function writeSources(
  backup: ParsedBackup,
  secrets: BackupSecrets,
  mode: ImportMode,
): Promise<{ written: Source[]; skipped: number; missingSecrets: number }> {
  const written: Source[] = [];
  let skipped = 0;
  let missingSecrets = 0;
  for (const item of backup.sources) {
    const existing = mode === 'merge' ? await sourcesRepo.get(item.id) : undefined;
    const sameKind = existing?.kind === item.kind ? existing : undefined;
    const secret = secrets.sources[item.id];
    let secretRef: string | undefined;
    if (item.kind !== 'm3u-file') {
      if (secret !== undefined) {
        secretRef = sameKind?.secretRef ?? vaultRef(item);
        await credentialVault.put(secretRef, secret);
      } else if (sameKind?.secretRef !== undefined) {
        secretRef = sameKind.secretRef;
      } else if (item.kind === 'm3u-url') {
        skipped++;
        continue;
      } else {
        missingSecrets++;
      }
    }
    const source = toSource(item, sameKind, secretRef);
    if (existing && !sameKind) await sourcesRepo.remove(existing.id);
    await sourcesRepo.put(source);
    written.push(source);
  }
  return { written, skipped, missingSecrets };
}

async function writeFavorites(backup: ParsedBackup, ids: Set<string>, mode: ImportMode) {
  const existing =
    mode === 'merge' ? new Set((await favoritesRepo.listAll()).map((f) => f.itemKey)) : new Set();
  const favorites: Favorite[] = backup.favorites
    .filter((f) => ids.has(f.sourceId) && !existing.has(f.itemKey))
    .map((f) => ({ itemKey: f.itemKey, sourceId: f.sourceId, type: f.type, addedAt: f.addedAt }));
  await favoritesRepo.putMany(favorites);
  return favorites.length;
}

async function writeHistory(backup: ParsedBackup, ids: Set<string>, mode: ImportMode) {
  const existing = new Map<string, number>();
  if (mode === 'merge') {
    for (const entry of await historyRepo.listAll()) {
      existing.set(entry.itemKey, entry.lastWatchedAt);
    }
  }
  const entries: HistoryEntry[] = backup.history
    .filter((h) => ids.has(h.sourceId) && (existing.get(h.itemKey) ?? -Infinity) < h.lastWatchedAt)
    .map((h) => ({ ...h }));
  await historyRepo.putMany(entries);
  return entries.length;
}

async function writeSettings(
  backup: ParsedBackup,
  secrets: BackupSecrets,
  ids: Set<string>,
  mode: ImportMode,
) {
  const { settings } = backup;
  if (mode === 'replace') {
    for (const key of BACKUP_SETTING_KEYS) {
      if (key !== 'personalProxy' && settings[key] === undefined) await settingsRepo.remove(key);
    }
  }
  if (settings.theme !== undefined) await settingsRepo.set('theme', settings.theme);
  if (settings.locale !== undefined) await settingsRepo.set('locale', settings.locale);
  for (const key of BACKUP_BOOLEAN_SETTINGS) {
    const value = settings[key];
    if (value !== undefined) await settingsRepo.set(key, value);
  }
  if (settings.activeSourceId !== undefined && ids.has(settings.activeSourceId)) {
    await settingsRepo.set('activeSourceId', settings.activeSourceId);
  }
  if (settings.personalProxy) {
    if (secrets.proxyToken !== undefined) {
      await savePersonalProxy({
        baseUrl: settings.personalProxy.baseUrl,
        token: secrets.proxyToken,
      });
    } else {
      // Without the token, the address only works with a token already on this device (merge).
      await settingsRepo.set('personalProxy', settings.personalProxy);
    }
  }
  if (ids.size > 0) await settingsRepo.set('onboardingDone', true);
}

export interface ApplyBackupOptions {
  mode: ImportMode;
  /** The export password, for a file with secrets; empty/absent imports without them. */
  password?: string;
}

/** Writes the backup. Throws {@link WrongBackupPasswordError} before writing anything. */
export async function applyBackup(
  backup: ParsedBackup,
  { mode, password }: ApplyBackupOptions,
): Promise<ImportResult> {
  const secrets = await unlockSecrets(backup, password);
  if (mode === 'replace') {
    for (const source of await sourcesRepo.list()) await sourcesRepo.remove(source.id);
    await removePersonalProxy();
  }
  const { written, skipped, missingSecrets } = await writeSources(backup, secrets, mode);
  const ids = new Set(written.map((s) => s.id));
  const favorites = await writeFavorites(backup, ids, mode);
  const history = await writeHistory(backup, ids, mode);
  await writeSettings(backup, secrets, ids, mode);

  const toSync = written.filter((s) => s.kind !== 'm3u-file' && s.secretRef !== undefined);
  markSourcesForSync(toSync.map((s) => s.id));
  log.info('backup: imported', {
    mode,
    sources: written.length,
    favorites,
    history,
    withSecrets: Object.keys(secrets.sources).length,
  });
  return {
    sources: written.length,
    skippedSources: skipped,
    missingSecrets,
    favorites,
    history,
    queuedForSync: toSync.length,
  };
}

/** Indirection so tests can observe the restart (jsdom cannot reload). */
export const backupRestart = {
  /** Reloads the app on "My lists", so every in-memory store re-reads the imported data. */
  restartOnLists(): void {
    window.history.replaceState(null, '', '#/settings/sources');
    window.location.reload();
  },
};
