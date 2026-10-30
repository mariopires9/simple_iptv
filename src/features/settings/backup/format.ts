// Backup file format (EXP-01), version 1:
//
//   {
//     format: "simple-iptv-export", version: 1, exportedAt: "<ISO date>",
//     sources:   [{ id, kind, name, serverUrl?, username?, epgUrl?, epgUrls?, prefs, createdAt }],
//     favorites: [{ itemKey, addedAt }],
//     history:   [{ itemKey, lastWatchedAt, positionSec?, durationSec?, episodeKey?, completed }],
//     settings:  { theme?, locale?, fullscreenOnLandscape?, playLastChannelOnOpen?,
//                  hideProtectedContent?, activeSourceId?, personalProxy?: { baseUrl } },
//     secretsIncluded?: { sources: [<source id>], proxyToken: boolean },   // not secret
//     secrets?: PasswordEnvelope                                          // only with a password
//   }
//
// Secrets (Xtream passwords, M3U list addresses, the proxy token) are only ever in `secrets`,
// encrypted with the export password (core/crypto `encryptWithPassword`, PBKDF2-SHA-256 ≥ 600 000
// iterations + AES-GCM). Catalogue data is never exported: lists are re-synced after an import.
//
// Reading: the file is untrusted (ADR-013, docs/SECURITY.md). Size-limited, the envelope must match
// exactly (format, version), and every list / favorite / history entry / setting is validated on
// its own: invalid ones are dropped and counted, never the whole file.
import * as v from 'valibot';
import {
  LANGUAGE_PREFERENCES,
  parseItemKey,
  THEMES,
  type ContentType,
  type LanguagePreference,
  type LiveFormat,
  type ProxyRouting,
  type SourceKind,
  type Theme,
} from '@/core/db';
import type { PasswordEnvelope } from '@/core/crypto';
import { parseProxyBaseUrl } from '@/core/net';

export const BACKUP_FORMAT = 'simple-iptv-export';
export const BACKUP_VERSION = 1;
/** Authenticated (not secret) data of the secrets envelope: binds it to this format version. */
export const BACKUP_AAD = `${BACKUP_FORMAT}/${BACKUP_VERSION}`;

/** Files larger than this are refused before being read. */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCES = 200;
export const MAX_FAVORITES = 50_000;
export const MAX_HISTORY = 50_000;
const MAX_URL = 2_048;
const MAX_SECRET = 8_192;

export interface BackupSource {
  id: string;
  kind: SourceKind;
  name: string;
  serverUrl?: string;
  username?: string;
  epgUrl?: string;
  epgUrls?: string[];
  prefs: { liveFormat: LiveFormat; proxy?: ProxyRouting };
  createdAt: number;
}

export interface BackupFavorite {
  itemKey: string;
  addedAt: number;
}

export interface BackupHistoryEntry {
  itemKey: string;
  lastWatchedAt: number;
  positionSec?: number;
  durationSec?: number;
  episodeKey?: string;
  completed: boolean;
}

export interface BackupSettings {
  theme?: Theme;
  locale?: LanguagePreference;
  fullscreenOnLandscape?: boolean;
  playLastChannelOnOpen?: boolean;
  hideProtectedContent?: boolean;
  activeSourceId?: string;
  personalProxy?: { baseUrl: string };
}

/** Boolean settings carried by a backup. */
export const BACKUP_BOOLEAN_SETTINGS = [
  'fullscreenOnLandscape',
  'playLastChannelOnOpen',
  'hideProtectedContent',
] as const;

/** Every setting key a backup carries (a replace-import resets the absent ones). */
export const BACKUP_SETTING_KEYS = [
  'theme',
  'locale',
  ...BACKUP_BOOLEAN_SETTINGS,
  'activeSourceId',
  'personalProxy',
] as const;

export interface BackupSecretsIncluded {
  /** Ids of the lists whose secret is in `secrets`. */
  sources: string[];
  proxyToken: boolean;
}

/** What `secrets` decrypts to. */
export interface BackupSecrets {
  /** Secret per list id: the Xtream password or the M3U list address. */
  sources: Record<string, string>;
  proxyToken?: string;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  sources: BackupSource[];
  favorites: BackupFavorite[];
  history: BackupHistoryEntry[];
  settings: BackupSettings;
  secretsIncluded?: BackupSecretsIncluded;
  secrets?: PasswordEnvelope;
}

// ---------------------------------------------------------------------------------------------
// Schemas (reading)
// ---------------------------------------------------------------------------------------------

const finiteNumber = v.pipe(v.number(), v.finite());
const sourceId = v.pipe(v.string(), v.regex(/^[^\s:]{1,128}$/));

const httpUrl = v.pipe(
  v.string(),
  v.maxLength(MAX_URL),
  v.check((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }),
);

const optionalIgnoringInvalid = <T extends v.GenericSchema>(schema: T) =>
  v.fallback(v.optional(schema), undefined);

const SourceSchema = v.pipe(
  v.object({
    id: sourceId,
    kind: v.picklist(['xtream', 'm3u-url', 'm3u-file'] as const satisfies readonly SourceKind[]),
    name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
    serverUrl: v.optional(httpUrl),
    username: v.optional(v.pipe(v.string(), v.maxLength(512))),
    epgUrl: optionalIgnoringInvalid(httpUrl),
    epgUrls: v.fallback(
      v.optional(
        v.pipe(
          v.array(v.unknown()),
          v.transform((urls) =>
            urls.filter((url): url is string => v.is(httpUrl, url)).slice(0, 20),
          ),
        ),
      ),
      undefined,
    ),
    prefs: v.fallback(
      v.object({
        liveFormat: v.fallback(
          v.picklist(['auto', 'ts', 'm3u8'] as const satisfies readonly LiveFormat[]),
          'auto',
        ),
        proxy: optionalIgnoringInvalid(
          v.picklist(['off', 'streams', 'all'] as const satisfies readonly ProxyRouting[]),
        ),
      }),
      { liveFormat: 'auto' as const },
    ),
    createdAt: v.fallback(finiteNumber, 0),
  }),
  // An Xtream list is unusable without its server and username.
  v.check((s) => s.kind !== 'xtream' || (s.serverUrl !== undefined && s.username !== undefined)),
);

const ItemKeySchema = v.pipe(
  v.string(),
  v.maxLength(1_024),
  v.check((key) => parseItemKey(key) !== undefined),
);

const FavoriteSchema = v.object({
  itemKey: ItemKeySchema,
  addedAt: v.fallback(finiteNumber, 0),
});

const HistorySchema = v.object({
  itemKey: ItemKeySchema,
  lastWatchedAt: finiteNumber,
  positionSec: optionalIgnoringInvalid(v.pipe(finiteNumber, v.minValue(0))),
  durationSec: optionalIgnoringInvalid(v.pipe(finiteNumber, v.minValue(0))),
  episodeKey: optionalIgnoringInvalid(v.pipe(v.string(), v.minLength(1), v.maxLength(1_024))),
  completed: v.fallback(v.boolean(), false),
});

const EnvelopeSchema = v.object({
  kdf: v.literal('PBKDF2-SHA-256'),
  iterations: v.pipe(v.number(), v.integer()),
  salt: v.pipe(v.string(), v.maxLength(64)),
  cipher: v.literal('AES-GCM-256'),
  iv: v.pipe(v.string(), v.maxLength(64)),
  ciphertext: v.pipe(v.string(), v.maxLength(4 * 1024 * 1024)),
});

const TopSchema = v.object({
  format: v.literal(BACKUP_FORMAT),
  version: v.number(),
  exportedAt: v.fallback(v.pipe(v.string(), v.maxLength(64)), ''),
  sources: v.pipe(v.array(v.unknown()), v.maxLength(MAX_SOURCES)),
  favorites: v.fallback(v.pipe(v.array(v.unknown()), v.maxLength(MAX_FAVORITES)), []),
  history: v.fallback(v.pipe(v.array(v.unknown()), v.maxLength(MAX_HISTORY)), []),
  settings: v.fallback(v.record(v.string(), v.unknown()), {}),
  secrets: v.optional(v.unknown()),
});

export const SecretsSchema = v.object({
  sources: v.record(sourceId, v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_SECRET))),
  proxyToken: v.optional(v.pipe(v.string(), v.maxLength(MAX_SECRET))),
});

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

/**
 * - `too-large`: over {@link MAX_BACKUP_BYTES};
 * - `not-json`: not JSON at all;
 * - `not-backup`: JSON, but not this app's export (or a broken envelope);
 * - `newer-version`: made by a newer version of the app.
 */
export type BackupReadError = 'too-large' | 'not-json' | 'not-backup' | 'newer-version';

export class BackupFileError extends Error {
  override readonly name = 'BackupFileError';
  constructor(readonly reason: BackupReadError) {
    super(`Not a usable backup file (${reason})`);
  }
}

export interface ParsedBackup {
  exportedAt: string;
  sources: BackupSource[];
  favorites: (BackupFavorite & { sourceId: string; type: ContentType })[];
  history: (BackupHistoryEntry & { sourceId: string; type: ContentType })[];
  settings: BackupSettings;
  /** The encrypted secrets, when the file has them. */
  secrets?: PasswordEnvelope;
  /** What the file says the encrypted secrets hold (for the preview). */
  secretsIncluded: BackupSecretsIncluded;
  /** Entries dropped because they were invalid (or point to a list not in the file). */
  skipped: number;
}

function parseSettings(raw: Record<string, unknown>, sourceIds: Set<string>): BackupSettings {
  const settings: BackupSettings = {};
  if (THEMES.includes(raw.theme as Theme)) settings.theme = raw.theme as Theme;
  if (LANGUAGE_PREFERENCES.includes(raw.locale as LanguagePreference)) {
    settings.locale = raw.locale as LanguagePreference;
  }
  for (const key of BACKUP_BOOLEAN_SETTINGS) {
    if (typeof raw[key] === 'boolean') settings[key] = raw[key];
  }
  if (typeof raw.activeSourceId === 'string' && sourceIds.has(raw.activeSourceId)) {
    settings.activeSourceId = raw.activeSourceId;
  }
  const proxy = raw.personalProxy;
  const baseUrl =
    proxy !== null && typeof proxy === 'object' ? (proxy as { baseUrl?: unknown }).baseUrl : '';
  if (typeof baseUrl === 'string' && baseUrl !== '') {
    const parsed = parseProxyBaseUrl(baseUrl);
    if (parsed.ok) settings.personalProxy = { baseUrl: parsed.baseUrl };
  }
  return settings;
}

function parseSecretsIncluded(raw: unknown, sourceIds: Set<string>): BackupSecretsIncluded {
  const value = (raw ?? {}) as { sources?: unknown; proxyToken?: unknown };
  return {
    sources: Array.isArray(value.sources)
      ? value.sources.filter((id): id is string => typeof id === 'string' && sourceIds.has(id))
      : [],
    proxyToken: value.proxyToken === true,
  };
}

/** Parses an export file's text. Throws {@link BackupFileError}. */
export function parseBackup(text: string): ParsedBackup {
  if (text.length > MAX_BACKUP_BYTES) throw new BackupFileError('too-large');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupFileError('not-json');
  }
  const top = v.safeParse(TopSchema, json);
  if (!top.success) throw new BackupFileError('not-backup');
  const file = top.output;
  if (!Number.isInteger(file.version) || file.version < 1) throw new BackupFileError('not-backup');
  if (file.version > BACKUP_VERSION) throw new BackupFileError('newer-version');

  let secrets: PasswordEnvelope | undefined;
  if (file.secrets !== undefined) {
    const envelope = v.safeParse(EnvelopeSchema, file.secrets);
    if (!envelope.success) throw new BackupFileError('not-backup');
    secrets = envelope.output;
  }

  let skipped = 0;
  const sources: BackupSource[] = [];
  const ids = new Set<string>();
  for (const raw of file.sources) {
    const parsed = v.safeParse(SourceSchema, raw);
    if (!parsed.success || ids.has(parsed.output.id)) {
      skipped++;
      continue;
    }
    ids.add(parsed.output.id);
    sources.push(withoutUndefined(parsed.output) as BackupSource);
  }

  const favorites: ParsedBackup['favorites'] = [];
  for (const raw of file.favorites) {
    const parsed = v.safeParse(FavoriteSchema, raw);
    const key = parsed.success ? parseItemKey(parsed.output.itemKey) : undefined;
    if (!parsed.success || !key || !ids.has(key.sourceId)) {
      skipped++;
      continue;
    }
    favorites.push({ ...parsed.output, sourceId: key.sourceId, type: key.type });
  }

  const history: ParsedBackup['history'] = [];
  for (const raw of file.history) {
    const parsed = v.safeParse(HistorySchema, raw);
    const key = parsed.success ? parseItemKey(parsed.output.itemKey) : undefined;
    if (!parsed.success || !key || !ids.has(key.sourceId)) {
      skipped++;
      continue;
    }
    history.push({
      ...(withoutUndefined(parsed.output) as BackupHistoryEntry),
      sourceId: key.sourceId,
      type: key.type,
    });
  }

  const included = parseSecretsIncluded(
    (json as { secretsIncluded?: unknown }).secretsIncluded,
    ids,
  );
  return {
    exportedAt: file.exportedAt,
    sources,
    favorites,
    history,
    settings: parseSettings(file.settings, ids),
    ...(secrets ? { secrets } : {}),
    secretsIncluded: secrets ? included : { sources: [], proxyToken: false },
    skipped,
  };
}

/** Drops `undefined` properties (exactOptionalPropertyTypes-friendly records). */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}
