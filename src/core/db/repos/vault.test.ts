// @vitest-environment node
// Node environment: real WebCrypto and structured clone of CryptoKey (fake-indexeddb).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb } from '../database';
import { openFreshDatabase } from '../test-utils';
import { vaultStore } from './vault';

beforeEach(async () => {
  await openFreshDatabase();
});

afterEach(async () => {
  await closeDatabase();
});

function aesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** True if `candidate` decrypts what `reference` encrypted (i.e. it is the same key). */
async function sameKey(reference: CryptoKey, candidate: CryptoKey): Promise<boolean> {
  const iv = new Uint8Array(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, reference, new Uint8Array([1]));
  try {
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, candidate, ct);
    return true;
  } catch {
    return false;
  }
}

describe('vaultStore.putKeyIfAbsent', () => {
  it('stores the key when none exists and returns it', async () => {
    const key = await aesKey();
    const stored = await vaultStore.putKeyIfAbsent({ id: 'k', key });
    expect(stored.key).toBe(key);
    const read = await vaultStore.getKey('k');
    expect(read).toBeDefined();
    expect(read?.key.extractable).toBe(false);
    expect(await sameKey(key, read!.key)).toBe(true);
  });

  it('keeps and returns the existing key instead of overwriting it', async () => {
    const first = await aesKey();
    const second = await aesKey();
    await vaultStore.putKeyIfAbsent({ id: 'k', key: first });
    const stored = await vaultStore.putKeyIfAbsent({ id: 'k', key: second });
    expect(await sameKey(first, stored.key)).toBe(true);
    expect(await sameKey(second, stored.key)).toBe(false);
    const read = await vaultStore.getKey('k');
    expect(await sameKey(first, read!.key)).toBe(true);
  });

  it('concurrent calls converge on a single stored key', async () => {
    const keys = await Promise.all([aesKey(), aesKey(), aesKey()]);
    const results = await Promise.all(
      keys.map((key) => vaultStore.putKeyIfAbsent({ id: 'k', key })),
    );
    const db = await getDb();
    expect(await db.keys.count()).toBe(1);
    const read = await vaultStore.getKey('k');
    for (const result of results) expect(await sameKey(read!.key, result.key)).toBe(true);
  });
});
