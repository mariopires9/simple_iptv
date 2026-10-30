// In-memory state of the master password lock (SEC-02, ADR-006). Dexie-free and dependency-free,
// so the shell (core/session, src/worker/client.ts) can import it without pulling the database
// into the initial bundle.
//
// - `unknown`: nothing decided yet (app start before the check, or the data worker before the main
//   thread sent it a key). A secret encrypted with the master key cannot be read (VaultLockedError).
// - `off`: no master password; secrets use the device key.
// - `locked`: a master password is set and its key is not in memory. Vault reads and writes wait
//   for `unlocked`; nothing can decrypt the secrets meanwhile.
// - `unlocked`: the derived key is in memory (never persisted, non-extractable).

export type VaultLockStatus = 'unknown' | 'off' | 'locked' | 'unlocked';

/** The key derived from the master password and the id (`kid`) its secrets are tagged with. */
export interface MasterKey {
  kid: string;
  key: CryptoKey;
}

/** Prefix of every master key id: tells master-encrypted rows apart from device-key rows. */
export const MASTER_KID_PREFIX = 'master:';

/** A secret is encrypted with the master key and the vault is not unlocked. No secret material. */
export class VaultLockedError extends Error {
  override readonly name = 'VaultLockedError';
  constructor() {
    super('The credential vault is locked');
  }
}

let status: VaultLockStatus = 'unknown';
let masterKey: MasterKey | null = null;
/** Increments on every key change (lets the worker client know when to resend it). */
let generation = 0;
const listeners = new Set<() => void>();
let waiters: (() => void)[] = [];

function update(next: VaultLockStatus, key: MasterKey | null): void {
  const changed = next !== status || key !== masterKey;
  status = next;
  if (key !== masterKey) generation += 1;
  masterKey = key;
  if (!changed) return;
  if (status !== 'locked') {
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  }
  for (const listener of [...listeners]) listener();
}

export function getVaultLockStatus(): VaultLockStatus {
  return status;
}

export function getMasterKey(): MasterKey | null {
  return masterKey;
}

export function getMasterKeyGeneration(): number {
  return generation;
}

export function subscribeVaultLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** No master password: secrets use the device key. */
export function setVaultLockOff(): void {
  update('off', null);
}

/** Drops the master key from memory: secret reads wait until `setMasterKey`. */
export function setVaultLocked(): void {
  update('locked', null);
}

/** The master password was verified: its key is held in memory until the next lock. */
export function setMasterKey(key: MasterKey): void {
  update('unlocked', key);
}

/** Back to `unknown` (the data worker when the main thread locks; tests). */
export function resetVaultLock(): void {
  update('unknown', null);
}

/**
 * Resolves at once unless the vault is `locked`, else when it stops being locked. With `signal`,
 * rejects with the signal's reason when aborted first.
 */
export function whenVaultUnlocked(signal?: AbortSignal): Promise<void> {
  if (status !== 'locked') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      waiters = waiters.filter((w) => w !== done);
      reject(signal?.reason);
    };
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    waiters.push(done);
  });
}
