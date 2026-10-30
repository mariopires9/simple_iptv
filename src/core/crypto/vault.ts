// CredentialVault (SRC-01, ADR-006, docs/SECURITY.md §1–2).
//
// Secrets (Xtream passwords, M3U URLs) are encrypted with AES-GCM 256 using a device key that is
// a non-extractable WebCrypto CryptoKey persisted in IndexedDB (structured clone keeps it
// non-extractable). The `secrets` table only ever holds `{ ref, kid, iv, ciphertext }`.
//
// - IV: 96 random bits per encryption.
// - Additional authenticated data: the UTF-8 bytes of `ref`, so a ciphertext copied to another
//   ref fails to decrypt.
// - Key identity: each key generation gets a random, non-secret `kid`; every secret row records
//   the `kid` it was encrypted with, so a regenerated key is reported as `missing-key` rather
//   than being mistaken for tampering.
// - Redaction: every secret passed to `put` or returned by `get` is registered with the log
//   redactor and stays registered for the rest of the session (until a page reload). It is never
//   unregistered: the redactor is global and not reference-counted, and under-redaction leaks
//   credentials while over-redaction is harmless.
// - Ordering: operations of one vault instance run one at a time, in call order, so e.g. a `put`
//   in flight cannot be overtaken by `delete`/`wipe` and resurrect data. Operations from other
//   instances or other tabs are NOT serialized with these; `putKeyIfAbsent` keeps the key
//   creation race-free and `get` tolerates a concurrent wipe, but a `put` in one tab racing a
//   `wipe` in another can still leave a secret behind.
//
// Master password (SEC-02): when one is set, every secret is encrypted with the key derived from it
// instead (rows tagged with its `master:` kid; see ./lockState and ./masterPassword). While locked,
// `get`/`put` wait for the unlock (outside the queue, so `delete`/`wipe` still run); a master row
// read without the key in memory (the data worker before the main thread sent it) throws
// `VaultLockedError`. `rekey` moves every secret between the two schemes in one transaction.
//
// What this does NOT protect against (ADR-006): code running on the same origin, anyone using the
// unlocked device, browser extensions, credentials embedded in stream URLs.
import { vaultStore, type KeyRecord, type SecretRecord, type SecretSwap } from '@/core/db';
import { log, registerSecret } from '@/core/log';
import {
  getMasterKey,
  getVaultLockStatus,
  MASTER_KID_PREFIX,
  VaultLockedError,
  whenVaultUnlocked,
  type MasterKey,
} from './lockState';

export interface CredentialVault {
  put(ref: string, secret: string): Promise<void>;
  get(ref: string): Promise<string | undefined>;
  delete(ref: string): Promise<void>;
  wipe(): Promise<void>;
}

/** Which key `rekey` re-encrypts every secret with: the device key or a master key. */
export type RekeyTarget = 'device' | MasterKey;

export interface RekeyResult {
  /** Secrets re-encrypted (and verified) under the target key. */
  reencrypted: number;
  /** Secrets that cannot be decrypted (key lost, tampered) and were left as they were. */
  unreadable: number;
}

/** Vault operations of the master password (SEC-02); the app's vault implements them. */
export interface CredentialVaultAdmin extends CredentialVault {
  /**
   * Re-encrypts every secret with `target` and, in the same IndexedDB transaction, sets
   * (`{ value }`) or removes (`null`) the `masterPassword` setting (`undefined`: unchanged). Each
   * new ciphertext is decrypted and compared before anything is written; a failure (or a row
   * changed meanwhile) writes nothing, so the secrets stay readable under the old scheme.
   * `onCommit` runs right after the commit, before the next queued operation (so a queued `put`
   * already uses the new scheme).
   */
  rekey(
    target: RekeyTarget,
    masterPassword?: { value: unknown } | null,
    onCommit?: () => void,
  ): Promise<RekeyResult>;
}

export interface CredentialVaultDeps {
  /** WebCrypto implementation. Defaults to `globalThis.crypto.subtle` (resolved lazily). */
  subtle?: SubtleCrypto;
  /** Fills the array with random bytes. Defaults to `crypto.getRandomValues`. */
  random?: (a: Uint8Array) => Uint8Array;
}

/**
 * - `missing-key`: a ciphertext exists but the key it was encrypted with is gone — no key at all
 *   (e.g. the browser partially cleared site data) or the key was regenerated since (`kid`
 *   mismatch). The user must re-enter the credential.
 * - `decrypt-failed`: the right key (same `kid`) is present but authentication failed — the
 *   ciphertext/IV was tampered with or the row was moved to another ref.
 */
export type VaultKeyLostReason = 'missing-key' | 'decrypt-failed';

/**
 * The secret for `ref` exists but cannot be recovered. The UI should ask the user to re-enter the
 * credential and call `put` again (which works: a missing key is regenerated on `put`).
 * The message never contains secret material.
 */
export class VaultKeyLostError extends Error {
  override readonly name = 'VaultKeyLostError';
  readonly ref: string;
  readonly reason: VaultKeyLostReason;

  constructor(ref: string, reason: VaultKeyLostReason, options?: { cause?: unknown }) {
    super(`Credential vault cannot decrypt secret (${reason})`, options);
    this.ref = ref;
    this.reason = reason;
  }
}

/** Id of the device key in the `keys` table. */
const KEY_ID = 'credential-vault/aes-gcm-256/v1';
const IV_BYTES = 12;
const KEY_ALGORITHM: AesKeyGenParams = { name: 'AES-GCM', length: 256 };

const KID_BYTES = 16;

function assertRef(ref: string): void {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new TypeError('CredentialVault: ref must be a non-empty string');
  }
}

/** Whether the row was encrypted with a master password key (SEC-02). Rows may be malformed. */
function isMasterRow(record: SecretRecord): boolean {
  return typeof record.kid === 'string' && record.kid.startsWith(MASTER_KID_PREFIX);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createCredentialVault(deps: CredentialVaultDeps = {}): CredentialVaultAdmin {
  const subtle = (): SubtleCrypto => deps.subtle ?? globalThis.crypto.subtle;
  const random: (a: Uint8Array) => Uint8Array =
    deps.random ?? ((a) => globalThis.crypto.getRandomValues(a as Uint8Array<ArrayBuffer>));
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  /** Tail of the per-instance operation queue (never rejects). */
  let tail: Promise<unknown> = Promise.resolve();

  /** Runs `op` after every previously enqueued operation of this instance has settled. */
  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = tail.then(op, op);
    tail = run.catch(() => undefined);
    return run;
  }

  function randomBytes(length: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(length);
    const filled = random(bytes);
    if (filled !== bytes) {
      if (filled.length !== length) throw new Error('CredentialVault: invalid random source');
      bytes.set(filled);
    }
    return bytes;
  }

  /**
   * Returns the device key, creating it on first use. Runs inside the queue, so one instance never
   * creates two keys; `putKeyIfAbsent` covers other instances/tabs. The key is never cached.
   */
  async function loadOrCreateKey(): Promise<KeyRecord> {
    const existing = await vaultStore.getKey(KEY_ID);
    if (existing) return existing;
    const key = await subtle().generateKey(KEY_ALGORITHM, false, ['encrypt', 'decrypt']);
    const kid = toHex(randomBytes(KID_BYTES));
    const stored = await vaultStore.putKeyIfAbsent({ id: KEY_ID, kid, key });
    if (stored.kid === kid) log.info('credential vault: device key generated');
    return stored;
  }

  async function encryptWith(
    ref: string,
    secret: string,
    target: { kid: string; key: CryptoKey },
  ): Promise<SecretRecord> {
    const iv = randomBytes(IV_BYTES);
    const ciphertext = await subtle().encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(ref) },
      target.key,
      encoder.encode(secret),
    );
    return { ref, kid: target.kid, iv, ciphertext };
  }

  /** Key secrets are written with now: the master key when unlocked, else the device key. */
  async function writeKey(): Promise<{ kid: string; key: CryptoKey }> {
    const master = getMasterKey();
    if (master) return master;
    if (getVaultLockStatus() === 'locked') throw new VaultLockedError();
    return loadOrCreateKey();
  }

  /** Decrypts `record` (does not register the result with the redactor). */
  async function decryptRecord(record: SecretRecord): Promise<string> {
    const { ref } = record;
    let key: CryptoKey;
    if (isMasterRow(record)) {
      const master = getMasterKey();
      if (!master) throw new VaultLockedError();
      if (master.kid !== record.kid) {
        log.warn('credential vault: secret encrypted with another master key', { ref });
        throw new VaultKeyLostError(ref, 'missing-key');
      }
      key = master.key;
    } else {
      const keyRecord = await vaultStore.getKey(KEY_ID);
      if (!keyRecord) {
        log.warn('credential vault: device key missing', { ref });
        throw new VaultKeyLostError(ref, 'missing-key');
      }
      if (record.kid !== keyRecord.kid) {
        log.warn('credential vault: secret encrypted with a previous key', { ref });
        throw new VaultKeyLostError(ref, 'missing-key');
      }
      key = keyRecord.key;
    }
    let plaintext: ArrayBuffer;
    try {
      plaintext = await subtle().decrypt(
        { name: 'AES-GCM', iv: record.iv, additionalData: encoder.encode(ref) },
        key,
        record.ciphertext,
      );
    } catch (error) {
      log.warn('credential vault: decryption failed', { ref });
      throw new VaultKeyLostError(ref, 'decrypt-failed', { cause: error });
    }
    return decoder.decode(plaintext);
  }

  /** While locked, `op` is queued only once unlocked (so the wait never blocks `delete`/`wipe`). */
  function afterUnlock<T>(op: () => Promise<T>): Promise<T> {
    if (getVaultLockStatus() === 'locked') return whenVaultUnlocked().then(() => enqueue(op));
    return enqueue(op);
  }

  // Methods are `async` but do their validation, redactor registration and `enqueue` call
  // synchronously (before any await), so the queue order is exactly the call order (while the
  // vault is not locked).
  return {
    async put(ref, secret) {
      assertRef(ref);
      if (typeof secret !== 'string') {
        throw new TypeError('CredentialVault: secret must be a string');
      }
      // Register (after validation) before any await, so even an error on the way cannot leak it.
      registerSecret(secret);
      return afterUnlock(async () => {
        const record = await encryptWith(ref, secret, await writeKey());
        await vaultStore.putSecret(record);
      });
    },

    async get(ref) {
      assertRef(ref);
      return afterUnlock(async () => {
        const record = await vaultStore.getSecret(ref);
        if (!record) return undefined;
        if (!isMasterRow(record) && !(await vaultStore.getKey(KEY_ID))) {
          // A wipe from another instance/tab may have removed both in between: re-check.
          if (!(await vaultStore.getSecret(ref))) return undefined;
        }
        const secret = await decryptRecord(record);
        registerSecret(secret);
        return secret;
      });
    },

    async delete(ref) {
      assertRef(ref);
      return enqueue(() => vaultStore.deleteSecret(ref));
    },

    async wipe() {
      return enqueue(async () => {
        await vaultStore.clear();
        log.info('credential vault: wiped');
      });
    },

    async rekey(target, masterPassword, onCommit) {
      return enqueue(async () => {
        const key = target === 'device' ? await loadOrCreateKey() : target;
        const rows = await vaultStore.listSecrets();
        const swaps: SecretSwap[] = [];
        let unreadable = 0;
        for (const row of rows) {
          if (row.kid === key.kid) continue;
          let secret: string;
          try {
            secret = await decryptRecord(row);
          } catch (error) {
            // Already unrecoverable under the old scheme: leave it (the user re-enters it).
            if (error instanceof VaultKeyLostError) {
              unreadable += 1;
              continue;
            }
            throw error;
          }
          registerSecret(secret);
          const next = await encryptWith(row.ref, secret, key);
          // Verify before anything is written: the new ciphertext must decrypt to the secret.
          const check = decoder.decode(
            await subtle().decrypt(
              { name: 'AES-GCM', iv: next.iv, additionalData: encoder.encode(row.ref) },
              key.key,
              next.ciphertext,
            ),
          );
          if (check !== secret) throw new Error('CredentialVault: re-encryption check failed');
          swaps.push({ expected: row, next });
        }
        await vaultStore.swapSecrets(swaps, masterPassword);
        onCommit?.();
        log.info('credential vault: secrets re-encrypted', {
          target: target === 'device' ? 'device' : 'master',
          count: swaps.length,
          unreadable,
        });
        return { reencrypted: swaps.length, unreadable };
      });
    },
  };
}

/** Default instance (uses the global WebCrypto and the app database). */
export const credentialVault: CredentialVaultAdmin = createCredentialVault();
