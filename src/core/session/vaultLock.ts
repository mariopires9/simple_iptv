// Master password lock of this session (SEC-02, ADR-006): start-up check, unlock, lock (on demand
// and after some minutes in the background), and turning the master password on and off.
// The status lives in `@/core/crypto/lockState` (Dexie-free, imported statically); everything
// that touches the database or WebCrypto is loaded lazily, so this module stays in the initial
// bundle without Dexie. The unlock screen (features/settings) is only loaded when a master
// password is set.
import {
  getVaultLockStatus,
  setVaultLocked,
  setVaultLockOff,
  subscribeVaultLock,
  whenVaultUnlocked,
  type VaultLockStatus,
} from '@/core/crypto/lockState';
import { log } from '@/core/log';

export { getVaultLockStatus, subscribeVaultLock, whenVaultUnlocked, type VaultLockStatus };

export const DEFAULT_LOCK_MINUTES = 5;
/** Choices offered in Settings (0 = as soon as the app goes to the background). */
export const LOCK_MINUTE_CHOICES = [0, 1, 5, 15, 30, 60] as const;
/** Shortest master password accepted when turning it on. */
export const MIN_MASTER_PASSWORD_LENGTH = 8;

const CHANGED_MESSAGE = 'master-password-changed';

let lockMinutes: number = DEFAULT_LOCK_MINUTES;

const modules = () => Promise.all([import('@/core/db'), import('@/core/crypto')]);

function validMinutes(value: unknown): number | undefined {
  return (LOCK_MINUTE_CHOICES as readonly unknown[]).includes(value)
    ? (value as number)
    : undefined;
}

/**
 * Start-up check (before any screen that reads secrets): `locked` when a master password is set,
 * else `off`. A stored config that is not valid also locks (fail closed: only "delete all data"
 * gets out of it). Keeps the vault unlocked if it already is with the same key (another tab's
 * change notification). If the check itself fails, the vault locks (fail closed) and the error
 * is rethrown: the unlock screen retries the read (see `unlockVault`).
 */
export async function initVaultLock(): Promise<VaultLockStatus> {
  try {
    return await checkVaultLock();
  } catch (error) {
    log.warn('master password: the start-up check failed, locking', { error });
    setVaultLocked();
    throw error;
  }
}

async function checkVaultLock(): Promise<VaultLockStatus> {
  // Only the database (already open for the start-up check): the crypto chunk loads only when a
  // master password is set, so the check costs one settings read when it is off (QA-04).
  const { settingsRepo } = await import('@/core/db');
  const [stored, minutes] = await Promise.all([
    settingsRepo.get('masterPassword'),
    settingsRepo.get('masterPasswordLockMinutes'),
  ]);
  lockMinutes = validMinutes(minutes) ?? DEFAULT_LOCK_MINUTES;
  if (stored === undefined) {
    setVaultLockOff();
    return 'off';
  }
  const crypto = await import('@/core/crypto');
  const config = crypto.parseMasterPasswordConfig(stored);
  if (!config) log.warn('master password: the stored configuration is not valid');
  if (config && crypto.getMasterKey()?.kid === config.kid) return getVaultLockStatus();
  setVaultLocked();
  return 'locked';
}

/** The master password changed (another tab) while a key was being derived: try again. */
export class MasterPasswordChangedError extends Error {
  override readonly name = 'MasterPasswordChangedError';
  constructor() {
    super('The master password changed meanwhile');
  }
}

/**
 * The config is re-read after the (slow) derivation: a key is only loaded if it still belongs to
 * the stored config, else another tab turned the master password off or replaced it meanwhile.
 */
async function assertStillCurrent(kid: string): Promise<void> {
  const [{ settingsRepo }, crypto] = await modules();
  const current = crypto.parseMasterPasswordConfig(await settingsRepo.get('masterPassword'));
  if (current?.kid === kid) return;
  await initVaultLock().catch(() => undefined);
  throw new MasterPasswordChangedError();
}

/**
 * Rejects with `WrongMasterPasswordError` when the password is not the master password, and with
 * `MasterPasswordChangedError` when another tab changed it meanwhile. With no master password
 * stored (e.g. a vault locked because the start-up check failed) the vault is simply off.
 */
export async function unlockVault(password: string): Promise<void> {
  const [{ settingsRepo }, crypto] = await modules();
  const stored = await settingsRepo.get('masterPassword');
  if (stored === undefined) {
    setVaultLockOff();
    return;
  }
  const config = crypto.parseMasterPasswordConfig(stored);
  if (!config) throw new crypto.WrongMasterPasswordError();
  const key = await crypto.openMasterPassword(config, password);
  await assertStillCurrent(key.kid);
  crypto.setMasterKey(key);
  log.info('master password: unlocked');
  // A secret written with the device key while the master password was set (e.g. by a tab that
  // had not seen it yet) is moved under the master key; aborts if the config changed meanwhile.
  void crypto.credentialVault.rekey(key, { expectedKid: key.kid }).catch((error: unknown) => {
    log.warn('master password: re-encryption after unlock failed', { error });
  });
}

/** Locks now (drops the key from memory). No-op unless unlocked. */
export function lockVaultNow(): void {
  if (getVaultLockStatus() !== 'unlocked') return;
  setVaultLocked();
  log.info('master password: locked');
}

/**
 * Turns the master password on: derives a new key, re-encrypts every secret with it and stores
 * the config, in one transaction (a failure leaves everything under the device key). Leaves the
 * vault unlocked.
 */
export async function enableMasterPassword(password: string): Promise<void> {
  if (getVaultLockStatus() !== 'off') throw new Error('master password: already set');
  if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
    throw new RangeError('master password: too short');
  }
  const [, crypto] = await modules();
  const { config, key } = await crypto.createMasterPassword(password);
  // Aborts (nothing written) if another tab set a master password meanwhile.
  await crypto.credentialVault.rekey(key, {
    expectedKid: null,
    masterPassword: { value: config },
    onCommit: () => crypto.setMasterKey(key),
  });
  log.info('master password: enabled');
  announceChange();
}

/**
 * Turns the master password off after checking `password` (`WrongMasterPasswordError`):
 * re-encrypts every secret with the device key and removes the config, in one transaction.
 */
export async function disableMasterPassword(password: string): Promise<void> {
  const [{ settingsRepo }, crypto] = await modules();
  const config = crypto.parseMasterPasswordConfig(await settingsRepo.get('masterPassword'));
  if (!config) throw new crypto.WrongMasterPasswordError();
  const key = await crypto.openMasterPassword(config, password);
  await assertStillCurrent(key.kid);
  // Reading needs the key: also covers a vault locked meanwhile.
  crypto.setMasterKey(key);
  // Aborts (nothing written) if another tab changed the master password meanwhile.
  await crypto.credentialVault.rekey('device', {
    expectedKid: key.kid,
    masterPassword: null,
    onCommit: () => setVaultLockOff(),
  });
  log.info('master password: disabled');
  announceChange();
}

/** Minutes in the background before the vault locks. */
export function getAutoLockMinutes(): number {
  return lockMinutes;
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  const valid = validMinutes(minutes);
  if (valid === undefined) throw new RangeError('master password: invalid lock delay');
  const { settingsRepo } = await import('@/core/db');
  await settingsRepo.set('masterPasswordLockMinutes', valid);
  lockMinutes = valid;
}

function channelName(): string {
  return `simple-iptv:vault-lock:${new URL(import.meta.env.BASE_URL, globalThis.location.href).href}`;
}

/** Tells the app's other tabs to re-check the lock. Best effort. */
function announceChange(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(channelName());
    channel.postMessage(CHANGED_MESSAGE);
    channel.close();
  } catch {
    // Other tabs pick the change up on their next start.
  }
}

export interface AutoLockOptions {
  document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  now?: () => number;
}

/**
 * Locks after `getAutoLockMinutes()` in the background (`visibilitychange`): a timer while hidden
 * (may be throttled) and a check of the elapsed time when the page is shown again. Also re-checks
 * the lock when another tab turns the master password on or off. Returns the cleanup.
 */
export function installVaultAutoLock({
  document: doc = globalThis.document,
  now = Date.now,
}: AutoLockOptions = {}): () => void {
  let hiddenAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const onVisibility = () => {
    const delay = lockMinutes * 60_000;
    if (doc.visibilityState === 'hidden') {
      if (getVaultLockStatus() !== 'unlocked') return;
      hiddenAt = now();
      clear();
      if (delay === 0) lockVaultNow();
      else timer = setTimeout(lockVaultNow, delay);
      return;
    }
    clear();
    if (hiddenAt !== undefined && now() - hiddenAt >= delay) lockVaultNow();
    hiddenAt = undefined;
  };
  doc.addEventListener('visibilitychange', onVisibility);

  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(channelName());
      channel.onmessage = (event: MessageEvent) => {
        if (event.data !== CHANGED_MESSAGE) return;
        void initVaultLock().catch((error: unknown) => {
          log.warn('master password: re-check failed', { error });
        });
      };
    }
  } catch {
    channel = undefined;
  }

  return () => {
    clear();
    doc.removeEventListener('visibilitychange', onVisibility);
    channel?.close();
  };
}
