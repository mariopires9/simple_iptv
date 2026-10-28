// Raw vault storage (`secrets` and `keys` tables) for core/crypto (SRC-01).
// Only stores already-encrypted data and the non-extractable CryptoKey; never plaintext secrets.
import { getDb } from '../database';
import type { KeyRecord, SecretRecord } from '../types';

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

  /** Deletes all secrets and keys (CredentialVault.wipe). */
  async clear(): Promise<void> {
    const db = await getDb();
    await db.transaction('rw', db.secrets, db.keys, async () => {
      await Promise.all([db.secrets.clear(), db.keys.clear()]);
    });
  },
};
