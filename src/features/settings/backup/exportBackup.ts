// Settings › Backup — export (EXP-01): builds the backup file (see ./format) from storage and hands
// it to the browser as a download. Secrets are read from the vault and written ONLY when the user
// set an export password, encrypted with it; without one the file holds no secret at all.
import {
  credentialVault,
  encryptWithPassword,
  type PasswordCipherDeps,
  type PasswordEnvelope,
  whenVaultUnlocked,
} from '@/core/crypto';
import { favoritesRepo, historyRepo, settingsRepo, sourcesRepo, type Source } from '@/core/db';
import { log } from '@/core/log';
import { PROXY_TOKEN_REF } from '@/core/session';
import {
  BACKUP_AAD,
  BACKUP_BOOLEAN_SETTINGS,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupFile,
  type BackupSecrets,
  type BackupSettings,
  type BackupSource,
} from './format';

export interface BuildBackupOptions extends PasswordCipherDeps {
  /** Export password; absent or empty = no secrets in the file. */
  password?: string;
  now?: Date;
  /** Tests only (production always uses the minimum, 600 000). */
  iterations?: number;
}

export interface BuiltBackup {
  file: BackupFile;
  /** Lists whose secret could not be read from the vault (left out of the file). */
  unreadableSecrets: number;
}

function toBackupSource(source: Source): BackupSource {
  const out: BackupSource = {
    id: source.id,
    kind: source.kind,
    name: source.name,
    prefs: {
      liveFormat: source.prefs.liveFormat,
      ...(source.prefs.proxy !== undefined ? { proxy: source.prefs.proxy } : {}),
    },
    createdAt: source.createdAt,
  };
  if (source.serverUrl !== undefined) out.serverUrl = source.serverUrl;
  if (source.username !== undefined) out.username = source.username;
  if (source.epgUrl !== undefined) out.epgUrl = source.epgUrl;
  if (source.epgUrls !== undefined) out.epgUrls = [...source.epgUrls];
  return out;
}

async function readSettings(sourceIds: Set<string>): Promise<BackupSettings> {
  const settings: BackupSettings = {};
  const [theme, locale, activeSourceId, personalProxy] = await Promise.all([
    settingsRepo.get('theme'),
    settingsRepo.get('locale'),
    settingsRepo.get('activeSourceId'),
    settingsRepo.get('personalProxy'),
  ]);
  if (theme !== undefined) settings.theme = theme;
  if (locale !== undefined) settings.locale = locale;
  for (const key of BACKUP_BOOLEAN_SETTINGS) {
    const value = await settingsRepo.get(key);
    if (typeof value === 'boolean') settings[key] = value;
  }
  if (activeSourceId !== undefined && sourceIds.has(activeSourceId)) {
    settings.activeSourceId = activeSourceId;
  }
  const baseUrl: unknown = (personalProxy as { baseUrl?: unknown } | undefined)?.baseUrl;
  if (typeof baseUrl === 'string') settings.personalProxy = { baseUrl };
  return settings;
}

/** Builds the backup from storage (catalogue data excluded). */
export async function buildBackup(options: BuildBackupOptions = {}): Promise<BuiltBackup> {
  const { password, now = new Date() } = options;
  const sources = await sourcesRepo.list();
  const ids = new Set(sources.map((s) => s.id));
  const [favorites, history, settings] = await Promise.all([
    favoritesRepo.listAll(),
    historyRepo.listAll(),
    readSettings(ids),
  ]);
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    sources: sources.map(toBackupSource),
    favorites: favorites
      .filter((f) => ids.has(f.sourceId))
      .map((f) => ({ itemKey: f.itemKey, addedAt: f.addedAt })),
    history: history
      .filter((h) => ids.has(h.sourceId))
      .map((h) => ({
        itemKey: h.itemKey,
        lastWatchedAt: h.lastWatchedAt,
        completed: h.completed,
        ...(h.positionSec !== undefined ? { positionSec: h.positionSec } : {}),
        ...(h.durationSec !== undefined ? { durationSec: h.durationSec } : {}),
        ...(h.episodeKey !== undefined ? { episodeKey: h.episodeKey } : {}),
      })),
    settings,
  };

  let unreadableSecrets = 0;
  if (password !== undefined && password !== '') {
    // SEC-02: secrets are exported only after the master password unlocked the vault.
    await whenVaultUnlocked();
    // Null prototype: ids are plain own keys, never inherited properties.
    const secrets: BackupSecrets = { sources: Object.create(null) as Record<string, string> };
    for (const source of sources) {
      if (source.secretRef === undefined) continue;
      try {
        const secret = await credentialVault.get(source.secretRef);
        if (secret !== undefined) secrets.sources[source.id] = secret;
      } catch (error) {
        unreadableSecrets++;
        log.warn('backup: a list secret could not be read, left out', {
          sourceId: source.id,
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
    if (settings.personalProxy) {
      const token = await credentialVault.get(PROXY_TOKEN_REF).catch(() => undefined);
      if (token !== undefined) secrets.proxyToken = token;
    }
    const envelope: PasswordEnvelope = await encryptWithPassword(
      JSON.stringify(secrets),
      password,
      {
        aad: BACKUP_AAD,
        ...(options.iterations !== undefined ? { iterations: options.iterations } : {}),
        ...(options.subtle ? { subtle: options.subtle } : {}),
        ...(options.random ? { random: options.random } : {}),
      },
    );
    file.secretsIncluded = {
      sources: Object.keys(secrets.sources),
      proxyToken: secrets.proxyToken !== undefined,
    };
    file.secrets = envelope;
  }
  return { file, unreadableSecrets };
}

/** `simple-iptv-YYYY-MM-DD.json`, in the device's local date. */
export function backupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `simple-iptv-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

export function serializeBackup(file: BackupFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Saves `text` as a download (Blob + object URL, revoked right after the click). */
export function downloadText(text: string, fileName: string, doc: Document = document): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  try {
    const link = doc.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    link.style.display = 'none';
    doc.body.append(link);
    link.click();
    link.remove();
  } finally {
    // The click starts the download synchronously; revoking on the next task is safe everywhere.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
