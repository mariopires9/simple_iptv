// EXP-01 — export/import: roundtrip with and without an export password, secrets never in the file
// without one (and never in plain text with one), wrong password and tampered/invalid files
// rejected before anything is written, item-by-item validation, merge vs replace, imported secrets
// in the vault and imported lists queued for a sync. Synthetic hosts and secrets only.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialVault, encryptWithPassword, MIN_PBKDF2_ITERATIONS } from '@/core/crypto';
import {
  favoritesRepo,
  historyRepo,
  itemKey,
  settingsRepo,
  sourcesRepo,
  wipeAll,
  type Source,
} from '@/core/db';
import { clearSecrets } from '@/core/log';
import {
  loadPersonalProxy,
  PROXY_TOKEN_REF,
  savePersonalProxy,
  takeSourcesPendingSync,
} from '@/core/session';
import { backupFileName, buildBackup, serializeBackup } from './exportBackup';
import {
  BACKUP_AAD,
  BACKUP_FORMAT,
  BackupFileError,
  MAX_BACKUP_BYTES,
  parseBackup,
} from './format';
import {
  applyBackup,
  BackupImportError,
  previewBackup,
  readBackupFile,
  WrongBackupPasswordError,
} from './importBackup';

const XTREAM_PASSWORD = 'synthetic-xtream-pass-42';
const M3U_URL = 'http://m3u.example.test/get.php?username=demo&password=synthetic-m3u-pass';
const PROXY_TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
const EXPORT_PASSWORD = 'correct horse battery';
// List ids are UUIDs (the only format an import accepts); sorted F < LOCAL < M < X.
const F = '00000000-0000-4000-8000-000000000001';
const LOCAL = '00000000-0000-4000-8000-000000000002';
const M = '00000000-0000-4000-8000-000000000003';
const X = '00000000-0000-4000-8000-000000000004';
const OK = '00000000-0000-4000-8000-0000000000aa';
const KEEP = '00000000-0000-4000-8000-000000000005';

const source = (id: string, extra: Partial<Source> = {}): Source => ({
  id,
  kind: 'xtream',
  name: `List ${id}`,
  serverUrl: 'http://panel.example.test:8080',
  username: 'demo',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  lastSyncAt: 1_000,
  stats: { live: 10, movies: 0, series: 0 },
  ...extra,
});

/** Xtream list X (password), M3U-URL list M (address), local file F; favorites/history; settings. */
async function seedDevice() {
  await credentialVault.put(`source:${X}:password`, XTREAM_PASSWORD);
  await credentialVault.put(`source:${M}:url`, M3U_URL);
  await sourcesRepo.put(
    source(X, { secretRef: `source:${X}:password`, prefs: { liveFormat: 'ts', proxy: 'streams' } }),
  );
  await sourcesRepo.put(source(M, { kind: 'm3u-url', secretRef: `source:${M}:url`, createdAt: 2 }));
  await sourcesRepo.put(source(F, { kind: 'm3u-file', createdAt: 3 }));
  await favoritesRepo.add(itemKey(X, 'live', '101'), 50);
  await favoritesRepo.add(itemKey(M, 'movie', '7'), 60);
  await historyRepo.set({
    itemKey: itemKey(X, 'movie', '9'),
    lastWatchedAt: 500,
    positionSec: 42,
    durationSec: 100,
  });
  await settingsRepo.set('theme', 'light');
  await settingsRepo.set('locale', 'pt-PT');
  await settingsRepo.set('playLastChannelOnOpen', true);
  await settingsRepo.set('activeSourceId', M);
  await savePersonalProxy({ baseUrl: 'https://pc.example.test', token: PROXY_TOKEN });
}

async function wipeDevice() {
  clearSecrets();
  await wipeAll();
  takeSourcesPendingSync();
}

afterEach(async () => {
  vi.restoreAllMocks();
  await wipeDevice();
});

async function exportText(password?: string) {
  const { file } = await buildBackup({
    ...(password ? { password } : {}),
    now: new Date(2026, 9, 30),
  });
  return serializeBackup(file);
}

describe('export (EXP-01)', () => {
  it('is a versioned JSON file named by date, without catalogue data', async () => {
    await seedDevice();
    const json = JSON.parse(await exportText()) as Record<string, unknown>;
    expect(json).toMatchObject({ format: BACKUP_FORMAT, version: 1 });
    expect(json.sources).toHaveLength(3);
    expect(json.favorites).toHaveLength(2);
    expect(json.history).toHaveLength(1);
    expect(json.settings).toEqual({
      theme: 'light',
      locale: 'pt-PT',
      playLastChannelOnOpen: true,
      activeSourceId: M,
      personalProxy: { baseUrl: 'https://pc.example.test' },
    });
    expect(json).not.toHaveProperty('channels');
    expect(JSON.stringify(json.sources)).not.toMatch(/stats|lastSync|secretRef/);
    expect(backupFileName(new Date(2026, 0, 5))).toBe('simple-iptv-2026-01-05.json');
  });

  it('without a password the file holds no secret at all', async () => {
    await seedDevice();
    const text = await exportText();
    for (const secret of [XTREAM_PASSWORD, M3U_URL, 'synthetic-m3u-pass', PROXY_TOKEN]) {
      expect(text).not.toContain(secret);
    }
    const json = JSON.parse(text) as Record<string, unknown>;
    expect(json).not.toHaveProperty('secrets');
    expect(json).not.toHaveProperty('secretsIncluded');
  });

  it('with a password the secrets are encrypted (PBKDF2 ≥ 600 000, random salt and IV)', async () => {
    await seedDevice();
    const first = await exportText(EXPORT_PASSWORD);
    const second = await exportText(EXPORT_PASSWORD);
    for (const text of [first, second]) {
      for (const secret of [XTREAM_PASSWORD, M3U_URL, 'synthetic-m3u-pass', PROXY_TOKEN]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toContain(EXPORT_PASSWORD);
    }
    const a = (JSON.parse(first) as { secrets: Record<string, unknown> }).secrets;
    const b = (JSON.parse(second) as { secrets: Record<string, unknown> }).secrets;
    expect(a).toMatchObject({ kdf: 'PBKDF2-SHA-256', cipher: 'AES-GCM-256' });
    expect(a.iterations).toBeGreaterThanOrEqual(MIN_PBKDF2_ITERATIONS);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(JSON.parse(first)).toMatchObject({
      secretsIncluded: { sources: [X, M], proxyToken: true },
    });
  });
});

describe('import (EXP-01)', () => {
  it('roundtrip with a password: everything back, secrets in the vault, lists queued for sync', async () => {
    await seedDevice();
    const text = await exportText(EXPORT_PASSWORD);
    await wipeDevice();

    const backup = parseBackup(text);
    expect(previewBackup(backup)).toEqual({
      sources: 3,
      favorites: 2,
      history: 1,
      settings: 5,
      encrypted: true,
      sourceSecrets: 2,
      proxyToken: true,
      proxyAddressIgnored: false,
      skipped: 0,
    });
    const result = await applyBackup(backup, { mode: 'replace', password: EXPORT_PASSWORD });
    expect(result).toMatchObject({ sources: 3, skippedSources: 0, missingSecrets: 0 });

    const lists = await sourcesRepo.list();
    expect(lists.map((s) => s.id)).toEqual([X, M, F]);
    const x = lists[0]!;
    expect(x).toMatchObject({
      kind: 'xtream',
      serverUrl: 'http://panel.example.test:8080',
      username: 'demo',
      prefs: { liveFormat: 'ts', proxy: 'streams' },
      lastSyncStatus: 'never',
      stats: { live: 0, movies: 0, series: 0 },
    });
    expect(await credentialVault.get(x.secretRef!)).toBe(XTREAM_PASSWORD);
    expect(await credentialVault.get(lists[1]!.secretRef!)).toBe(M3U_URL);
    expect(await favoritesRepo.has(itemKey(X, 'live', '101'))).toBe(true);
    expect(await historyRepo.get(itemKey(X, 'movie', '9'))).toMatchObject({
      positionSec: 42,
      durationSec: 100,
      lastWatchedAt: 500,
      completed: false,
    });
    expect(await settingsRepo.get('theme')).toBe('light');
    expect(await settingsRepo.get('locale')).toBe('pt-PT');
    expect(await settingsRepo.get('playLastChannelOnOpen')).toBe(true);
    expect(await settingsRepo.get('activeSourceId')).toBe(M);
    expect(await loadPersonalProxy()).toEqual({
      baseUrl: 'https://pc.example.test',
      token: PROXY_TOKEN,
    });
    // Catalogue is re-synced: the lists with a usable secret are queued (a local file cannot be).
    expect(takeSourcesPendingSync()).toEqual([X, M]);
  });

  it('roundtrip without a password: config back, no secrets; an M3U-URL list without its address is left out', async () => {
    await seedDevice();
    const text = await exportText();
    await wipeDevice();

    const backup = parseBackup(text);
    expect(previewBackup(backup)).toMatchObject({ encrypted: false, sourceSecrets: 0 });
    const result = await applyBackup(backup, { mode: 'replace' });
    expect(result).toMatchObject({ sources: 2, skippedSources: 1, missingSecrets: 1 });
    const lists = await sourcesRepo.list();
    expect(lists.map((s) => s.id)).toEqual([X, F]);
    expect(lists[0]!.secretRef).toBeUndefined();
    expect(await credentialVault.get(PROXY_TOKEN_REF)).toBeUndefined();
    // The M3U list's favorite went with it; the active list fell back.
    expect(await favoritesRepo.has(itemKey(M, 'movie', '7'))).toBe(false);
    expect(await settingsRepo.get('activeSourceId')).toBeUndefined();
    expect(takeSourcesPendingSync()).toEqual([]);
  });

  it('an encrypted file imported with an empty password brings no secrets', async () => {
    await seedDevice();
    const backup = parseBackup(await exportText(EXPORT_PASSWORD));
    await wipeDevice();
    const result = await applyBackup(backup, { mode: 'merge', password: '' });
    expect(result).toMatchObject({ sources: 2, missingSecrets: 1 });
    expect((await sourcesRepo.get(X))?.secretRef).toBeUndefined();
  });

  it('a wrong password is rejected before anything is written', async () => {
    await seedDevice();
    const backup = parseBackup(await exportText(EXPORT_PASSWORD));
    await wipeDevice();
    await sourcesRepo.put(source(KEEP));
    await expect(
      applyBackup(backup, { mode: 'replace', password: 'not the password' }),
    ).rejects.toBeInstanceOf(WrongBackupPasswordError);
    expect((await sourcesRepo.list()).map((s) => s.id)).toEqual([KEEP]);
  });

  it('tampered secrets are rejected like a wrong password', async () => {
    await seedDevice();
    const json = JSON.parse(await exportText(EXPORT_PASSWORD)) as {
      secrets: { ciphertext: string };
    };
    const bytes = atob(json.secrets.ciphertext);
    json.secrets.ciphertext = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1));
    const backup = parseBackup(JSON.stringify(json));
    await expect(
      applyBackup(backup, { mode: 'merge', password: EXPORT_PASSWORD }),
    ).rejects.toBeInstanceOf(WrongBackupPasswordError);
  });

  it('rejects invalid files: not JSON, not a backup, newer version, broken envelope, too large', async () => {
    const reason = (text: string) => {
      try {
        parseBackup(text);
        return 'parsed';
      } catch (error) {
        return error instanceof BackupFileError ? error.reason : 'other';
      }
    };
    const valid = { format: BACKUP_FORMAT, version: 1, sources: [] };
    expect(reason('{nope')).toBe('not-json');
    expect(reason('[]')).toBe('not-backup');
    expect(reason(JSON.stringify({ ...valid, format: 'other-app' }))).toBe('not-backup');
    expect(reason(JSON.stringify({ ...valid, sources: 'x' }))).toBe('not-backup');
    expect(reason(JSON.stringify({ ...valid, version: 2 }))).toBe('newer-version');
    expect(reason(JSON.stringify({ ...valid, secrets: { kdf: 'none' } }))).toBe('not-backup');
    expect(reason(JSON.stringify(valid))).toBe('parsed');
    await expect(
      readBackupFile(new Blob([' '.repeat(MAX_BACKUP_BYTES + 1)])),
    ).rejects.toMatchObject({ reason: 'too-large' });
  });

  it('validates item by item: invalid lists, favorites, history and settings are dropped', () => {
    const backup = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: 1,
        sources: [
          {
            id: OK,
            kind: 'xtream',
            name: 'Good',
            serverUrl: 'http://a.example.test',
            username: 'u',
            prefs: { liveFormat: 'bogus' },
          },
          {
            id: 'bad:id',
            kind: 'xtream',
            name: 'x',
            serverUrl: 'http://a.example.test',
            username: 'u',
          },
          {
            id: '00000000-0000-4000-8000-0000000000fe',
            kind: 'xtream',
            name: 'x',
            serverUrl: 'javascript:alert(1)',
            username: 'u',
          },
          { id: '00000000-0000-4000-8000-0000000000ff', name: 'x' },
          { id: '__proto__', kind: 'm3u-file', name: 'Prototype' },
          { id: 'constructor', kind: 'm3u-file', name: 'Constructor' },
          { id: OK, kind: 'm3u-file', name: 'Duplicate id' },
        ],
        favorites: [
          { itemKey: `${OK}:live:1`, addedAt: 1 },
          { itemKey: 'other:live:1', addedAt: 1 },
          { itemKey: 'garbage' },
        ],
        history: [{ itemKey: `${OK}:movie:2`, lastWatchedAt: 'yesterday' }],
        settings: {
          theme: 'neon',
          locale: 'en',
          hideProtectedContent: 'yes',
          activeSourceId: 'nope',
        },
      }),
    );
    expect(backup.sources).toHaveLength(1);
    expect(backup.sources[0]).toMatchObject({ id: OK, prefs: { liveFormat: 'auto' } });
    expect(backup.favorites.map((f) => f.itemKey)).toEqual([`${OK}:live:1`]);
    expect(backup.history).toEqual([]);
    expect(backup.settings).toEqual({ locale: 'en' });
    expect(backup.skipped).toBe(6 + 2 + 1);
  });

  it('merge keeps what is on the device; replace removes it first', async () => {
    await seedDevice();
    const text = await exportText(EXPORT_PASSWORD);
    await wipeDevice();

    const seedOther = async () => {
      await credentialVault.put(`source:${LOCAL}:password`, 'local-pass');
      await sourcesRepo.put(source(LOCAL, { secretRef: `source:${LOCAL}:password`, createdAt: 0 }));
      await favoritesRepo.add(itemKey(LOCAL, 'live', '1'), 1);
      // The same list X already here, with a newer history entry than the backup's.
      await sourcesRepo.put(source(X, { name: 'Old name', secretRef: `source:${X}:password` }));
      await credentialVault.put(`source:${X}:password`, 'old-pass');
      await historyRepo.set({ itemKey: itemKey(X, 'movie', '9'), lastWatchedAt: 900 });
    };

    await seedOther();
    await applyBackup(parseBackup(text), { mode: 'merge', password: EXPORT_PASSWORD });
    expect((await sourcesRepo.list()).map((s) => s.id).sort()).toEqual([F, LOCAL, M, X]);
    expect(await favoritesRepo.has(itemKey(LOCAL, 'live', '1'))).toBe(true);
    const x = await sourcesRepo.get(X);
    expect(x).toMatchObject({ name: `List ${X}`, lastSyncStatus: 'ok', stats: { live: 10 } });
    // The file's secret went in under a new ref; the replaced one is gone.
    expect(await credentialVault.get(x!.secretRef!)).toBe(XTREAM_PASSWORD);
    expect(await credentialVault.get(`source:${X}:password`)).toBeUndefined();
    expect((await historyRepo.get(itemKey(X, 'movie', '9')))?.lastWatchedAt).toBe(900);

    await wipeDevice();
    await seedOther();
    await applyBackup(parseBackup(text), { mode: 'replace', password: EXPORT_PASSWORD });
    expect((await sourcesRepo.list()).map((s) => s.id).sort()).toEqual([F, M, X]);
    expect(await favoritesRepo.has(itemKey(LOCAL, 'live', '1'))).toBe(false);
    expect(await credentialVault.get(`source:${LOCAL}:password`)).toBeUndefined();
    expect(await sourcesRepo.get(X)).toMatchObject({ lastSyncStatus: 'never' });
    expect((await historyRepo.get(itemKey(X, 'movie', '9')))?.lastWatchedAt).toBe(500);
  });
});

describe('import security review regressions (EXP-01)', () => {
  const ATTACKER = 'https://attacker.example.test';

  /** A plain (no secrets) backup of one Xtream list X, optionally with a proxy address. */
  const plainFile = (extra: Record<string, unknown> = {}, list: Record<string, unknown> = {}) =>
    JSON.stringify({
      format: BACKUP_FORMAT,
      version: 1,
      sources: [
        {
          id: X,
          kind: 'xtream',
          name: 'List',
          serverUrl: 'http://panel.example.test:8080',
          username: 'demo',
          ...list,
        },
      ],
      ...extra,
    });

  it('a proxy address without its token is never paired with the device token', async () => {
    await savePersonalProxy({ baseUrl: 'https://pc.example.test', token: PROXY_TOKEN });
    const backup = parseBackup(plainFile({ settings: { personalProxy: { baseUrl: ATTACKER } } }));
    expect(previewBackup(backup).proxyAddressIgnored).toBe(true);

    await applyBackup(backup, { mode: 'merge' });
    expect(await loadPersonalProxy()).toEqual({
      baseUrl: 'https://pc.example.test',
      token: PROXY_TOKEN,
    });

    await applyBackup(backup, { mode: 'replace' });
    expect(await loadPersonalProxy()).toBeUndefined();
    expect(await settingsRepo.get('personalProxy')).toBeUndefined();
  });

  it('merge drops the stored password when the server or username changes', async () => {
    await credentialVault.put(`source:${X}:password`, XTREAM_PASSWORD);
    await sourcesRepo.put(source(X, { secretRef: `source:${X}:password` }));

    await applyBackup(parseBackup(plainFile()), { mode: 'merge' });
    expect((await sourcesRepo.get(X))?.secretRef).toBe(`source:${X}:password`);

    await applyBackup(parseBackup(plainFile({}, { serverUrl: 'http://evil.example.test:8080' })), {
      mode: 'merge',
    });
    expect((await sourcesRepo.get(X))?.secretRef).toBeUndefined();
    expect(await credentialVault.get(`source:${X}:password`)).toBeUndefined();

    await credentialVault.put(`source:${X}:password`, XTREAM_PASSWORD);
    await sourcesRepo.put(source(X, { secretRef: `source:${X}:password` }));
    await applyBackup(parseBackup(plainFile({}, { username: 'someone-else' })), { mode: 'merge' });
    expect((await sourcesRepo.get(X))?.secretRef).toBeUndefined();
  });

  it('ids like __proto__ / constructor are rejected item by item, also in the secrets', async () => {
    await sourcesRepo.put(source(KEEP));
    const secrets = await encryptWithPassword(
      '{"sources":{"__proto__":"a","constructor":"b"}}',
      EXPORT_PASSWORD,
      { aad: BACKUP_AAD },
    );
    const backup = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: 1,
        sources: [
          { id: 'constructor', kind: 'm3u-url', name: 'a' },
          { id: '__proto__', kind: 'm3u-url', name: 'b' },
        ],
        secrets,
      }),
    );
    expect(backup.sources).toEqual([]);
    await expect(
      applyBackup(backup, { mode: 'merge', password: EXPORT_PASSWORD }),
    ).resolves.toMatchObject({ sources: 0 });
    expect((await sourcesRepo.list()).map((s) => s.id)).toEqual([KEEP]);
  });

  it('replace: a failure while writing the new secrets changes nothing', async () => {
    await seedDevice();
    const backup = parseBackup(await exportText(EXPORT_PASSWORD));
    const put = credentialVault.put.bind(credentialVault);
    let calls = 0;
    vi.spyOn(credentialVault, 'put').mockImplementation((ref, secret) =>
      ++calls === 2 ? Promise.reject(new Error('quota')) : put(ref, secret),
    );
    const error = await applyBackup(backup, { mode: 'replace', password: EXPORT_PASSWORD }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(BackupImportError);
    expect((error as BackupImportError).changed).toBe(false);
    vi.restoreAllMocks();
    // The device is as it was: its lists, their sync state and their secrets.
    expect((await sourcesRepo.list()).map((s) => s.id)).toEqual([X, M, F]);
    expect(await credentialVault.get(`source:${X}:password`)).toBe(XTREAM_PASSWORD);
    expect((await sourcesRepo.get(X))?.lastSyncStatus).toBe('ok');
  });

  it('replace: a failure after the old data was removed is reported as changed', async () => {
    await seedDevice();
    const backup = parseBackup(await exportText(EXPORT_PASSWORD));
    vi.spyOn(favoritesRepo, 'putMany').mockRejectedValue(new Error('disk'));
    await expect(
      applyBackup(backup, { mode: 'replace', password: EXPORT_PASSWORD }),
    ).rejects.toMatchObject({ name: 'BackupImportError', changed: true });
  });
});
