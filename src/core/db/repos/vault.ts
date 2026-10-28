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

  async putKey(record: KeyRecord): Promise<void> {
    const db = await getDb();
    await db.keys.put(record);
  },

  /** Deletes all secrets and keys (CredentialVault.wipe). */
  async clear(): Promise<void> {
    const db = await getDb();
    await db.transaction('rw', db.secrets, db.keys, async () => {
      await Promise.all([db.secrets.clear(), db.keys.clear()]);
    });
  },
};
