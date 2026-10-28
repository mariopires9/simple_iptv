// Armazenamento bruto do cofre (tabelas `secrets` e `keys`) para core/crypto (SRC-01).
// Só guarda dados já cifrados e a CryptoKey não exportável; nunca segredos em claro.
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

  /** Apaga todos os segredos e chaves (CredentialVault.wipe). */
  async clear(): Promise<void> {
    const db = await getDb();
    await db.transaction('rw', db.secrets, db.keys, async () => {
      await Promise.all([db.secrets.clear(), db.keys.clear()]);
    });
  },
};
