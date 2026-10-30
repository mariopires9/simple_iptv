// Raw vault storage (`secrets` and `keys` tables) for core/crypto (SRC-01).
// Only stores already-encrypted data and the non-extractable CryptoKey; never plaintext secrets.
import { getDb } from '../database';
import type { KeyRecord, SecretRecord, SettingsEntry } from '../types';

/** A secret row to replace, and the row it must still be (compare-and-swap on the IV). */
export interface SecretSwap {
  expected: SecretRecord;
  next: SecretRecord;
}

/** Thrown by `swapSecrets` when a row changed since it was read: nothing was written. */
export class VaultSwapConflictError extends Error {
  override readonly name = 'VaultSwapConflictError';
  constructor() {
    super('A vault secret changed during re-encryption');
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const vaultStore = {
  async getSecret(ref: string): Promise<SecretRecord | undefined> {
    const db = await getDb();
    return db.secrets.get(ref);
  },

  async putSecret(record: SecretRecord): Promise<void> {
    const db = await getDb();
    await db.secrets.put(record);
  },

  async deleteSecret(ref: string): Promise<void> {
    const db = await getDb();
    await db.secrets.delete(ref);
  },

  async getKey(id: string): Promise<KeyRecord | undefined> {
    const db = await getDb();
    return db.keys.get(id);
  },

  /**
   * Stores `record` only if no key with the same id exists yet, atomically (single rw
   * transaction). Returns the key that ends up stored: the existing one or `record`.
   * Prevents two tabs/calls racing on first use from overwriting each other's key.
   */
  async putKeyIfAbsent(record: KeyRecord): Promise<KeyRecord> {
    const db = await getDb();
    return db.transaction('rw', db.keys, async () => {
      const existing = await db.keys.get(record.id);
      if (existing) return existing;
      await db.keys.add(record);
      return record;
    });
  },

  async listSecrets(): Promise<SecretRecord[]> {
    const db = await getDb();
    return db.secrets.toArray();
  },

  /**
   * SEC-02: replaces the given secret rows and sets (`value`) or removes (`null`) the
   * `masterPassword` setting, all in one rw transaction: either every change is written or none.
   * A row that is gone or no longer has the expected `kid`/IV aborts with
   * `VaultSwapConflictError`. `masterPassword: undefined` leaves the setting alone.
   */
  async swapSecrets(
    swaps: SecretSwap[],
    masterPassword?: { value: unknown } | null,
  ): Promise<void> {
    const db = await getDb();
    await db.transaction('rw', db.secrets, db.settings, async () => {
      for (const { expected, next } of swaps) {
        const current = await db.secrets.get(expected.ref);
        if (
          !current ||
          next.ref !== expected.ref ||
          current.kid !== expected.kid ||
          !sameBytes(current.iv, expected.iv)
        ) {
          throw new VaultSwapConflictError();
        }
      }
      await db.secrets.bulkPut(swaps.map((swap) => swap.next));
      if (masterPassword === null) await db.settings.delete('masterPassword');
      else if (masterPassword !== undefined) {
        const entry: SettingsEntry<'masterPassword'> = {
          key: 'masterPassword',
          value: masterPassword.value,
        };
        await db.settings.put(entry as SettingsEntry);
      }
    });
  },

  /** Deletes all secrets and keys (CredentialVault.wipe). */
  async clear(): Promise<void> {
    const db = await getDb();
    await db.transaction('rw', db.secrets, db.keys, async () => {
      await Promise.all([db.secrets.clear(), db.keys.clear()]);
    });
  },
};
