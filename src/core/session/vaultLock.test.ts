// @vitest-environment node
// SEC-02: master password — real WebCrypto (PBKDF2 600 000 iterations) and fake-indexeddb.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCredentialVault,
  createMasterPassword,
  credentialVault,
  getMasterKey,
  MASTER_KID_PREFIX,
  MIN_PBKDF2_ITERATIONS,
  resetVaultLock,
  VaultKeyLostError,
  VaultLockedError,
  WrongMasterPasswordError,
} from '@/core/crypto';
import {
  closeDatabase,
  openDatabase,
  settingsRepo,
  vaultStore,
  VaultSwapConflictError,
} from '@/core/db';
import { clearSecrets } from '@/core/log';
import {
  disableMasterPassword,
  enableMasterPassword,
  getVaultLockStatus,
  initVaultLock,
  installVaultAutoLock,
  lockVaultNow,
  MasterPasswordChangedError,
  setAutoLockMinutes,
  unlockVault,
} from './vaultLock';

// Synthetic values only.
const PASSWORD = 'synthetic master pw ✓';
const SECRETS = { 'xtream:a': 'synthetic-xtream-pass', 'm3u:b': 'https://example.test/list?k=1' };

/** Resolves on the next macrotask: enough for an unblocked vault read to finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function putAll() {
  for (const [ref, secret] of Object.entries(SECRETS)) await credentialVault.put(ref, secret);
}

async function readAll() {
  const out: Record<string, string | undefined> = {};
  for (const ref of Object.keys(SECRETS)) out[ref] = await credentialVault.get(ref);
  return out;
}

/** Simulates closing and reopening the app: the key in memory is gone. */
async function restart() {
  resetVaultLock();
  return initVaultLock();
}

beforeEach(async () => {
  await openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
  resetVaultLock();
  clearSecrets();
  expect(await initVaultLock()).toBe('off');
  await putAll();
});

afterEach(async () => {
  resetVaultLock();
  await closeDatabase();
  vi.useRealTimers();
});

describe('enable / disable (SEC-02)', () => {
  it('re-encrypts every secret with the master key and back with the device key', async () => {
    const deviceKids = new Set((await vaultStore.listSecrets()).map((r) => r.kid));
    await enableMasterPassword(PASSWORD);
    expect(getVaultLockStatus()).toBe('unlocked');

    const config = (await settingsRepo.get('masterPassword')) as Record<string, unknown>;
    expect(config).toMatchObject({ version: 1, kdf: 'PBKDF2-SHA-256' });
    expect(config.iterations).toBeGreaterThanOrEqual(MIN_PBKDF2_ITERATIONS);
    expect(typeof config.salt).toBe('string');
    expect(config.verifier).toBeDefined();
    // Only parameters and a verifier are stored: no password, no key.
    const stored = JSON.stringify(config);
    expect(stored).not.toContain(PASSWORD);
    expect(Object.values(config).some((v) => v instanceof CryptoKey)).toBe(false);

    const rows = await vaultStore.listSecrets();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.kid).toBe(config.kid);
      expect(row.kid.startsWith(MASTER_KID_PREFIX)).toBe(true);
    }
    expect(await readAll()).toEqual(SECRETS);

    // A secret saved while on is encrypted with the master key too.
    await credentialVault.put('proxy:token', 'synthetic-token');
    expect((await vaultStore.getSecret('proxy:token'))?.kid).toBe(config.kid);

    await disableMasterPassword(PASSWORD);
    expect(getVaultLockStatus()).toBe('off');
    expect(await settingsRepo.get('masterPassword')).toBeUndefined();
    for (const row of await vaultStore.listSecrets()) expect(deviceKids.has(row.kid)).toBe(true);
    expect(await readAll()).toEqual(SECRETS);
    expect(await credentialVault.get('proxy:token')).toBe('synthetic-token');
    // Off survives a restart without asking for anything.
    expect(await restart()).toBe('off');
    expect(await readAll()).toEqual(SECRETS);
  });

  it('a failed re-encryption writes nothing: the secrets stay readable with the device key', async () => {
    const swap = vi
      .spyOn(vaultStore, 'swapSecrets')
      .mockRejectedValueOnce(new Error('simulated write failure'));
    await expect(enableMasterPassword(PASSWORD)).rejects.toThrow('simulated write failure');
    swap.mockRestore();
    expect(getVaultLockStatus()).toBe('off');
    expect(await settingsRepo.get('masterPassword')).toBeUndefined();
    expect(await restart()).toBe('off');
    expect(await readAll()).toEqual(SECRETS);
  });

  it('a failed disable keeps everything under the master key', async () => {
    await enableMasterPassword(PASSWORD);
    const swap = vi
      .spyOn(vaultStore, 'swapSecrets')
      .mockRejectedValueOnce(new Error('simulated write failure'));
    await expect(disableMasterPassword(PASSWORD)).rejects.toThrow('simulated write failure');
    swap.mockRestore();
    expect(await restart()).toBe('locked');
    await unlockVault(PASSWORD);
    expect(await readAll()).toEqual(SECRETS);
  });
});

describe('wrong password (SEC-02)', () => {
  it('unlock and disable reject a wrong password and change nothing', async () => {
    await enableMasterPassword(PASSWORD);
    const before = await vaultStore.listSecrets();
    expect(await restart()).toBe('locked');

    await expect(unlockVault('not the password')).rejects.toBeInstanceOf(WrongMasterPasswordError);
    expect(getVaultLockStatus()).toBe('locked');
    expect(getMasterKey()).toBeNull();

    await expect(disableMasterPassword('not the password')).rejects.toBeInstanceOf(
      WrongMasterPasswordError,
    );
    expect(await settingsRepo.get('masterPassword')).toBeDefined();
    expect(await vaultStore.listSecrets()).toEqual(before);

    await unlockVault(PASSWORD);
    expect(getVaultLockStatus()).toBe('unlocked');
    expect(await readAll()).toEqual(SECRETS);
  });
});

describe('lock on open (SEC-02)', () => {
  it('secret reads wait for the unlock, then resolve', async () => {
    await enableMasterPassword(PASSWORD);
    expect(await restart()).toBe('locked');

    let read: string | undefined;
    const pending = credentialVault.get('xtream:a').then((value) => {
      read = value;
      return value;
    });
    // Deletion still runs while a read waits (it is not stuck behind the lock).
    await credentialVault.delete('unrelated');
    await settle();
    expect(read).toBeUndefined();

    await unlockVault(PASSWORD);
    expect(await pending).toBe(SECRETS['xtream:a']);
  });

  it('an invalid stored configuration locks (fail closed)', async () => {
    await settingsRepo.set('masterPassword', { version: 1, kdf: 'nope' });
    expect(await restart()).toBe('locked');
    await expect(unlockVault(PASSWORD)).rejects.toBeInstanceOf(WrongMasterPasswordError);
  });
});

describe('no secret readable while locked (SEC-02)', () => {
  it('without the key in memory the rows cannot be decrypted, not even by the device key', async () => {
    await enableMasterPassword(PASSWORD);
    lockVaultNow();
    expect(getVaultLockStatus()).toBe('locked');
    expect(getMasterKey()).toBeNull();

    // A vault that does not wait (like the data worker before it gets a key) cannot read them.
    resetVaultLock();
    const other = createCredentialVault();
    await expect(other.get('xtream:a')).rejects.toBeInstanceOf(VaultLockedError);

    // The device key is still in the database, but the rows are not encrypted with it.
    const db = await openDatabase();
    const [deviceKey] = await db.keys.toArray();
    const row = await vaultStore.getSecret('xtream:a');
    expect(deviceKey && row).toBeTruthy();
    await expect(
      crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: row!.iv,
          additionalData: new TextEncoder().encode('xtream:a'),
        },
        deviceKey!.key,
        row!.ciphertext,
      ),
    ).rejects.toThrow();
  });
});

describe('background lock (SEC-02)', () => {
  function fakeDocument() {
    const target = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    target.visibilityState = 'visible';
    const set = (state: DocumentVisibilityState) => {
      target.visibilityState = state;
      target.dispatchEvent(new Event('visibilitychange'));
    };
    return { doc: target, set };
  }

  it('locks after the configured minutes in the background (default 5)', async () => {
    await enableMasterPassword(PASSWORD);
    vi.useFakeTimers();
    const { doc, set } = fakeDocument();
    const cleanup = installVaultAutoLock({ document: doc as unknown as Document, now: Date.now });

    set('hidden');
    vi.advanceTimersByTime(4 * 60_000);
    set('visible');
    expect(getVaultLockStatus()).toBe('unlocked');

    set('hidden');
    vi.advanceTimersByTime(5 * 60_000);
    expect(getVaultLockStatus()).toBe('locked');
    expect(getMasterKey()).toBeNull();
    cleanup();
  });

  it('a throttled timer is caught up when the page is shown again', async () => {
    await enableMasterPassword(PASSWORD);
    await setAutoLockMinutes(1);
    let now = 1_000_000;
    const { doc, set } = fakeDocument();
    const cleanup = installVaultAutoLock({
      document: doc as unknown as Document,
      now: () => now,
    });
    set('hidden');
    now += 61_000; // the timer never fired (throttled background tab)
    set('visible');
    expect(getVaultLockStatus()).toBe('locked');
    cleanup();
  });
});

// Security review of SEC-02 (regressions).
describe('review fixes (SEC-02)', () => {
  it('1: a disable in another tab during an unlock never loads a stale key or re-encrypts', async () => {
    await enableMasterPassword(PASSWORD);
    expect(await restart()).toBe('locked');
    const before = await vaultStore.listSecrets();
    const read = vi.spyOn(settingsRepo, 'get');
    const unlocking = unlockVault(PASSWORD);
    // "Tab B" removes the config once tab A has read it, while A is still deriving the key.
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith('masterPassword'));
    await read.mock.results[0]?.value;
    read.mockRestore();
    await settingsRepo.remove('masterPassword');
    await expect(unlocking).rejects.toBeInstanceOf(MasterPasswordChangedError);
    expect(getMasterKey()).toBeNull();
    expect(getVaultLockStatus()).toBe('off');
    await settle();
    expect(await vaultStore.listSecrets()).toEqual(before);
  });

  it('1: a second enable (another tab) or a rekey against a changed config writes nothing', async () => {
    await enableMasterPassword(PASSWORD);
    const before = await vaultStore.listSecrets();
    const other = await createMasterPassword('another synthetic pw');
    await expect(
      credentialVault.rekey(other.key, {
        expectedKid: null,
        masterPassword: { value: other.config },
      }),
    ).rejects.toBeInstanceOf(VaultSwapConflictError);
    await expect(
      credentialVault.rekey(other.key, { expectedKid: other.key.kid }),
    ).rejects.toBeInstanceOf(VaultSwapConflictError);
    expect(await vaultStore.listSecrets()).toEqual(before);
    expect(await readAll()).toEqual(SECRETS);
  });

  it('2: with the master password off, an orphan master row is lost (not locked) and does not block enable', async () => {
    await enableMasterPassword(PASSWORD);
    await settingsRepo.remove('masterPassword'); // its config is gone
    expect(await restart()).toBe('off');
    const error: unknown = await credentialVault.get('xtream:a').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VaultKeyLostError);
    expect((error as VaultKeyLostError).reason).toBe('missing-key');
    await credentialVault.put('xtream:new', 'synthetic-new');
    await enableMasterPassword('a new synthetic pw');
    expect(await credentialVault.get('xtream:new')).toBe('synthetic-new');
  });

  it('3: a failing start-up check locks (fail closed); nothing is written while undecided', async () => {
    resetVaultLock();
    await expect(credentialVault.put('xtream:x', 'synthetic-x')).rejects.toBeInstanceOf(
      VaultLockedError,
    );
    expect(await vaultStore.getSecret('xtream:x')).toBeUndefined();

    const get = vi.spyOn(settingsRepo, 'get').mockRejectedValueOnce(new Error('read failed'));
    await expect(initVaultLock()).rejects.toThrow('read failed');
    get.mockRestore();
    expect(getVaultLockStatus()).toBe('locked');
    // The unlock screen copes: with no master password stored, unlocking turns the vault off.
    await unlockVault('anything');
    expect(getVaultLockStatus()).toBe('off');
    expect(await readAll()).toEqual(SECRETS);
  });

  it('5: reads queued while unlocked wait for the unlock if a lock lands before they run', async () => {
    await enableMasterPassword(PASSWORD);
    const first = credentialVault.get('xtream:a');
    const second = credentialVault.get('m3u:b');
    lockVaultNow();
    let settled = false;
    void Promise.allSettled([first, second]).then(() => (settled = true));
    await settle();
    expect(settled).toBe(false);
    await unlockVault(PASSWORD);
    expect(await Promise.all([first, second])).toEqual([SECRETS['xtream:a'], SECRETS['m3u:b']]);
  });
});
