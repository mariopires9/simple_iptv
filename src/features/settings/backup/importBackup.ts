// Settings › Backup — import (EXP-01): reads a picked file (./format validates it), previews it,
// then writes it in `merge` or `replace` mode. Imported secrets go into the vault (encrypted with
// this device's key); catalogue data is not in the file, so the imported lists are queued for a
// sync (`markSourcesForSync`) that the restarted app runs.
//
// - merge: the device's lists, favorites and history stay. A list already here (same id and kind)
//   gets the file's configuration and keeps its catalogue; it keeps its stored secret only when
//   the file has none AND the secret would still go to the same place (Xtream: same server origin
//   and username — otherwise the password must be entered again). Favorites already here are kept;
//   for history the newer entry wins. Settings in the file apply.
// - replace: every list on the device is removed (with its catalogue, favorites, history and
//   secret — `sourcesRepo.remove`), the personal proxy too, and the backed-up settings absent from
//   the file go back to their defaults.
// - Personal proxy: an imported address is applied ONLY together with the decrypted token
//   (`savePersonalProxy`). An address without a token is ignored (merge: the current proxy stays
//   as it is; replace: no proxy) — pairing this device's token with a file's address would send
//   the token, and the credentials inside stream URLs, to whoever wrote the file.
//
// Order (so a failure leaves as little as possible behind):
// 1. Everything that can fail without writing: decrypt and validate the secrets, read the device,
//    build every record.
// 2. The new secrets go into the vault under NEW refs (old secrets are untouched). A failure here
//    removes the refs already written: nothing changed (`BackupImportError`, `changed: false`).
// 3. Old data is removed, then the new data written; replaced secrets are deleted last. A failure
//    here may leave the device half-imported (`changed: true`): the UI must restart the app.
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
  isBackupSourceId,
  MAX_BACKUP_BYTES,
  MAX_SECRET,
  parseBackup,
  SecretsSchema,
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
  /** The file has a proxy address but no token: the address will be ignored. */
  proxyAddressIgnored: boolean;
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
    proxyAddressIgnored:
      backup.settings.personalProxy !== undefined && !backup.secretsIncluded.proxyToken,
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
 * The import failed. `changed: false` — nothing on the device was changed; `changed: true` — it
 * stopped part-way and the device may hold a mix of old and imported data (restart the app).
 */
export class BackupImportError extends Error {
  override readonly name = 'BackupImportError';
  constructor(
    readonly changed: boolean,
    options?: { cause?: unknown },
  ) {
    super(`The backup import failed (${changed ? 'partly applied' : 'nothing changed'})`, options);
  }
}

export interface UnlockedSecrets {
  /** Secret per list id (own entries only: never an inherited property). */
  sources: Map<string, string>;
  proxyToken?: string;
}

/**
 * Decrypts and validates the secrets, entry by entry. No password (or a file without secrets):
 * none. Throws {@link WrongBackupPasswordError}.
 */
export async function unlockSecrets(
  backup: ParsedBackup,
  password: string | undefined,
): Promise<UnlockedSecrets> {
  const none: UnlockedSecrets = { sources: new Map() };
  if (!backup.secrets || password === undefined || password === '') return none;
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
  for (const [id, secret] of Object.entries(parsed.output.sources)) {
    if (!isBackupSourceId(id) || typeof secret !== 'string') continue;
    if (secret.length === 0 || secret.length > MAX_SECRET) continue;
    registerSecret(secret);
    none.sources.set(id, secret);
  }
  const token = parsed.output.proxyToken;
  if (token !== undefined && isValidProxyToken(token)) {
    registerSecret(token);
    none.proxyToken = token;
  }
  return none;
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

/** A fresh vault ref per import, so writing new secrets never overwrites the current ones. */
function newVaultRef(source: BackupSource): string {
  const nonce = crypto.randomUUID();
  return `source:${source.id}:${source.kind === 'xtream' ? 'password' : 'url'}:${nonce}`;
}

function originOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Whether the stored secret of `existing` may stay with the imported configuration: it must still
 * reach the same place. Xtream: same server origin and username. M3U-URL: the secret IS the list
 * address, which the file (without secrets) cannot change.
 */
function mayKeepSecret(existing: Source, item: BackupSource): boolean {
  if (existing.kind === 'm3u-url') return true;
  const before = originOf(existing.serverUrl);
  return (
    before !== undefined &&
    before === originOf(item.serverUrl) &&
    existing.username === item.username
  );
}

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

interface ImportPlan {
  /** New secrets to write first (new refs). */
  newSecrets: { ref: string; secret: string }[];
  /** Lists of this device to remove before writing (replace; or a merge changing a list's kind). */
  removeSources: string[];
  sources: Source[];
  /** Secret refs no longer referenced once the import is written. */
  staleRefs: string[];
  favorites: Favorite[];
  history: HistoryEntry[];
  skipped: number;
  missingSecrets: number;
}

async function planImport(
  backup: ParsedBackup,
  secrets: UnlockedSecrets,
  mode: ImportMode,
): Promise<ImportPlan> {
  const device = await sourcesRepo.list();
  const byId = new Map(device.map((s) => [s.id, s]));
  const plan: ImportPlan = {
    newSecrets: [],
    removeSources: mode === 'replace' ? device.map((s) => s.id) : [],
    sources: [],
    staleRefs: [],
    favorites: [],
    history: [],
    skipped: 0,
    missingSecrets: 0,
  };
  for (const item of backup.sources) {
    const existing = mode === 'merge' ? byId.get(item.id) : undefined;
    const sameKind = existing?.kind === item.kind ? existing : undefined;
    const secret = secrets.sources.get(item.id);
    let secretRef: string | undefined;
    if (item.kind !== 'm3u-file') {
      if (secret !== undefined) {
        secretRef = newVaultRef(item);
        plan.newSecrets.push({ ref: secretRef, secret });
      } else if (sameKind?.secretRef !== undefined && mayKeepSecret(sameKind, item)) {
        secretRef = sameKind.secretRef;
      } else if (item.kind === 'm3u-url') {
        plan.skipped++;
        continue;
      } else {
        plan.missingSecrets++;
      }
    }
    if (existing?.secretRef !== undefined && existing.secretRef !== secretRef) {
      plan.staleRefs.push(existing.secretRef);
    }
    if (existing && !sameKind) plan.removeSources.push(existing.id);
    plan.sources.push(toSource(item, sameKind, secretRef));
  }

  const ids = new Set(plan.sources.map((s) => s.id));
  const favoriteKeys =
    mode === 'merge' ? new Set((await favoritesRepo.listAll()).map((f) => f.itemKey)) : new Set();
  plan.favorites = backup.favorites
    .filter((f) => ids.has(f.sourceId) && !favoriteKeys.has(f.itemKey))
    .map((f) => ({ itemKey: f.itemKey, sourceId: f.sourceId, type: f.type, addedAt: f.addedAt }));
  const watched = new Map<string, number>();
  if (mode === 'merge') {
    for (const entry of await historyRepo.listAll())
      watched.set(entry.itemKey, entry.lastWatchedAt);
  }
  plan.history = backup.history
    .filter((h) => ids.has(h.sourceId) && (watched.get(h.itemKey) ?? -Infinity) < h.lastWatchedAt)
    .map((h) => ({ ...h }));
  return plan;
}

async function writeSettings(
  backup: ParsedBackup,
  secrets: UnlockedSecrets,
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
  // Address and token only ever together (see the header). Without the token: ignored.
  if (settings.personalProxy && secrets.proxyToken !== undefined) {
    await savePersonalProxy({ baseUrl: settings.personalProxy.baseUrl, token: secrets.proxyToken });
  }
  if (ids.size > 0) await settingsRepo.set('onboardingDone', true);
}

export interface ApplyBackupOptions {
  mode: ImportMode;
  /** The export password, for a file with secrets; empty/absent imports without them. */
  password?: string;
}

/**
 * Writes the backup. Throws {@link WrongBackupPasswordError} (nothing written) or
 * {@link BackupImportError} (`changed` says whether the device was modified).
 */
export async function applyBackup(
  backup: ParsedBackup,
  { mode, password }: ApplyBackupOptions,
): Promise<ImportResult> {
  // 1. Nothing is written yet.
  const secrets = await unlockSecrets(backup, password);
  let plan: ImportPlan;
  try {
    plan = await planImport(backup, secrets, mode);
  } catch (error) {
    throw new BackupImportError(false, { cause: error });
  }

  // 2. New secrets under new refs; undone on failure.
  const written: string[] = [];
  try {
    for (const { ref, secret } of plan.newSecrets) {
      await credentialVault.put(ref, secret);
      written.push(ref);
    }
  } catch (error) {
    for (const ref of written) await credentialVault.delete(ref).catch(() => undefined);
    throw new BackupImportError(false, { cause: error });
  }

  // 3. Old data out, new data in.
  const ids = new Set(plan.sources.map((s) => s.id));
  try {
    for (const id of plan.removeSources) await sourcesRepo.remove(id);
    if (mode === 'replace') await removePersonalProxy();
    for (const source of plan.sources) await sourcesRepo.put(source);
    await favoritesRepo.putMany(plan.favorites);
    await historyRepo.putMany(plan.history);
    await writeSettings(backup, secrets, ids, mode);
    for (const ref of plan.staleRefs) await credentialVault.delete(ref);
  } catch (error) {
    throw new BackupImportError(true, { cause: error });
  }

  const toSync = plan.sources.filter((s) => s.kind !== 'm3u-file' && s.secretRef !== undefined);
  markSourcesForSync(toSync.map((s) => s.id));
  log.info('backup: imported', {
    mode,
    sources: plan.sources.length,
    favorites: plan.favorites.length,
    history: plan.history.length,
    withSecrets: plan.newSecrets.length,
  });
  return {
    sources: plan.sources.length,
    skippedSources: plan.skipped,
    missingSecrets: plan.missingSecrets,
    favorites: plan.favorites.length,
    history: plan.history.length,
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
