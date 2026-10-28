// CredentialVault (SRC-01, ADR-006, docs/SECURITY.md §1–2).
//
// Secrets (Xtream passwords, M3U URLs) are encrypted with AES-GCM 256 using a device key that is
// a non-extractable WebCrypto CryptoKey persisted in IndexedDB (structured clone keeps it
// non-extractable). The `secrets` table only ever holds `{ ref, iv, ciphertext }`.
//
// - IV: 96 random bits per encryption.
// - Additional authenticated data: the UTF-8 bytes of `ref`, so a ciphertext copied to another
//   ref fails to decrypt.
// - Every secret passed to `put` or returned by `get` is registered with the log redactor;
//   `delete`/`wipe` unregister the values this instance registered.
//
// What this does NOT protect against (ADR-006): code running on the same origin, anyone using the
// unlocked device, browser extensions, credentials embedded in stream URLs.
import { vaultStore } from '@/core/db';
import { log, registerSecret, unregisterSecret } from '@/core/log';

export interface CredentialVault {
  put(ref: string, secret: string): Promise<void>;
  get(ref: string): Promise<string | undefined>;
  delete(ref: string): Promise<void>;
  wipe(): Promise<void>;
}

export interface CredentialVaultDeps {
  /** WebCrypto implementation. Defaults to `globalThis.crypto.subtle` (resolved lazily). */
  subtle?: SubtleCrypto;
  /** Fills the array with random bytes. Defaults to `crypto.getRandomValues`. */
  random?: (a: Uint8Array) => Uint8Array;
}

/**
 * - `missing-key`: a ciphertext exists but the device key is gone (e.g. the browser partially
 *   cleared site data).
 * - `decrypt-failed`: the key exists but authentication failed — a different key (regenerated
 *   after loss), a tampered ciphertext/IV, or a ciphertext moved to another ref. AES-GCM cannot
 *   tell these apart, so they share one reason.
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

function assertRef(ref: string): void {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new TypeError('CredentialVault: ref must be a non-empty string');
  }
}

export function createCredentialVault(deps: CredentialVaultDeps = {}): CredentialVault {
  const subtle = (): SubtleCrypto => deps.subtle ?? globalThis.crypto.subtle;
  const random: (a: Uint8Array) => Uint8Array =
    deps.random ?? ((a) => globalThis.crypto.getRandomValues(a as Uint8Array<ArrayBuffer>));
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  /** Plaintexts this instance registered with the redactor, by ref (to unregister on delete). */
  const registered = new Map<string, string>();
  /** Single in-flight key load/creation, shared by concurrent first-use calls. */
  let keyInFlight: Promise<CryptoKey> | undefined;

  function track(ref: string, secret: string): void {
    registerSecret(secret);
    registered.set(ref, secret);
  }

  function untrack(ref: string): void {
    const secret = registered.get(ref);
    if (secret === undefined) return;
    registered.delete(ref);
    // Another ref may hold the same value: keep redacting it in that case.
    for (const other of registered.values()) if (other === secret) return;
    unregisterSecret(secret);
  }

  async function loadOrCreateKey(): Promise<CryptoKey> {
    const existing = await vaultStore.getKey(KEY_ID);
    if (existing) return existing.key;
    const key = await subtle().generateKey(KEY_ALGORITHM, false, ['encrypt', 'decrypt']);
    // Atomic check-and-add: another tab may have created the key in the meantime.
    const stored = await vaultStore.putKeyIfAbsent({ id: KEY_ID, key });
    if (stored.key === key) log.info('credential vault: device key generated');
    return stored.key;
  }

  /** Returns the device key, creating it on first use. The key itself is never cached. */
  function ensureKey(): Promise<CryptoKey> {
    if (!keyInFlight) {
      const promise = loadOrCreateKey().finally(() => {
        if (keyInFlight === promise) keyInFlight = undefined;
      });
      keyInFlight = promise;
    }
    return keyInFlight;
  }

  function newIv(): Uint8Array<ArrayBuffer> {
    const iv = new Uint8Array(IV_BYTES);
    const filled = random(iv);
    if (filled !== iv) {
      if (filled.length !== IV_BYTES) throw new Error('CredentialVault: invalid random source');
      iv.set(filled);
    }
    return iv;
  }

  return {
    async put(ref, secret) {
      assertRef(ref);
      if (typeof secret !== 'string')
        throw new TypeError('CredentialVault: secret must be a string');
      // Register before any await so that even an error on the way cannot leak it to the logs.
      track(ref, secret);
      const key = await ensureKey();
      const iv = newIv();
      const ciphertext = await subtle().encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(ref) },
        key,
        encoder.encode(secret),
      );
      await vaultStore.putSecret({ ref, iv, ciphertext });
    },

    async get(ref) {
      assertRef(ref);
      const record = await vaultStore.getSecret(ref);
      if (!record) return undefined;
      const keyRecord = await vaultStore.getKey(KEY_ID);
      if (!keyRecord) {
        log.warn('credential vault: device key missing', { ref });
        throw new VaultKeyLostError(ref, 'missing-key');
      }
      let plaintext: ArrayBuffer;
      try {
        plaintext = await subtle().decrypt(
          { name: 'AES-GCM', iv: record.iv, additionalData: encoder.encode(ref) },
          keyRecord.key,
          record.ciphertext,
        );
      } catch (error) {
        log.warn('credential vault: decryption failed', { ref });
        throw new VaultKeyLostError(ref, 'decrypt-failed', { cause: error });
      }
      const secret = decoder.decode(plaintext);
      track(ref, secret);
      return secret;
    },

    async delete(ref) {
      assertRef(ref);
      await vaultStore.deleteSecret(ref);
      untrack(ref);
    },

    async wipe() {
      await vaultStore.clear();
      for (const ref of [...registered.keys()]) untrack(ref);
      log.info('credential vault: wiped');
    },
  };
}

/** Default instance (uses the global WebCrypto and the app database). */
export const credentialVault: CredentialVault = createCredentialVault();
