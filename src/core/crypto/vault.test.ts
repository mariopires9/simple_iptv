// @vitest-environment node
// Node environment: real WebCrypto (Node 24) and structured clone of CryptoKey in fake-indexeddb.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, openDatabase } from '@/core/db';
import { clearSecrets, MASK, redact, registerSecret, unregisterSecret } from '@/core/log';
import {
  createCredentialVault,
  credentialVault,
  VaultKeyLostError,
  type CredentialVault,
} from './index';

vi.mock('@/core/log', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/log')>();
  return {
    ...actual,
    registerSecret: vi.fn(actual.registerSecret),
    unregisterSecret: vi.fn(actual.unregisterSecret),
  };
});

const SECRET = 'synthetic-p4ssw0rd-çã-✓';

async function rawDb() {
  return openDatabase();
}

beforeEach(async () => {
  await openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
  clearSecrets();
  vi.mocked(registerSecret).mockClear();
  vi.mocked(unregisterSecret).mockClear();
});

afterEach(async () => {
  await closeDatabase();
});

/** Wraps the real SubtleCrypto so calls can be spied on. */
function spySubtle() {
  const real = globalThis.crypto.subtle;
  const generateKey = vi.fn(real.generateKey.bind(real));
  const subtle = {
    generateKey,
    encrypt: real.encrypt.bind(real),
    decrypt: real.decrypt.bind(real),
  } as unknown as SubtleCrypto;
  return { subtle, generateKey };
}

function utf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i += 1) view.setUint16(i * 2, text.charCodeAt(i), littleEndian);
  return out;
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function expectKeyLost(vault: CredentialVault, ref: string, reason: string) {
  const error: unknown = await vault.get(ref).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(VaultKeyLostError);
  expect((error as VaultKeyLostError).reason).toBe(reason);
  expect((error as VaultKeyLostError).ref).toBe(ref);
  expect((error as Error).message).not.toContain(SECRET);
}

describe('AC1 — device key', () => {
  it('generates no key until first use', async () => {
    const vault = createCredentialVault();
    expect(await vault.get('missing')).toBeUndefined();
    const db = await rawDb();
    expect(await db.keys.count()).toBe(0);
  });

  it('on first put generates a non-extractable AES-GCM 256 key and stores it', async () => {
    const { subtle, generateKey } = spySubtle();
    const vault = createCredentialVault({ subtle });
    await vault.put('secret-a', SECRET);

    expect(generateKey).toHaveBeenCalledTimes(1);
    expect(generateKey).toHaveBeenCalledWith({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);

    const db = await rawDb();
    const keys = await db.keys.toArray();
    expect(keys).toHaveLength(1);
    const key = keys[0]!.key;
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect([...key.usages].sort()).toEqual(['decrypt', 'encrypt']);
  });

  it('the stored key cannot be exported (raw or jwk)', async () => {
    await createCredentialVault().put('secret-a', SECRET);
    const db = await rawDb();
    const key = (await db.keys.toArray())[0]!.key;
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('jwk', key)).rejects.toThrow();
  });

  it('reuses the stored key across instances (e.g. after a reload)', async () => {
    await createCredentialVault().put('secret-a', SECRET);
    const { subtle, generateKey } = spySubtle();
    const reloaded = createCredentialVault({ subtle });
    expect(await reloaded.get('secret-a')).toBe(SECRET);
    await reloaded.put('secret-b', 'another-secret');
    expect(generateKey).not.toHaveBeenCalled();
    const db = await rawDb();
    expect(await db.keys.count()).toBe(1);
  });
});

describe('AC2 — only iv + ciphertext are stored', () => {
  it('the raw secrets table never contains the plaintext', async () => {
    const vault = createCredentialVault();
    await vault.put('secret-a', SECRET);

    const db = await rawDb();
    const rows = await db.secrets.toArray();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Object.keys(row).sort()).toEqual(['ciphertext', 'iv', 'ref']);
    expect(row.ref).toBe('secret-a');
    expect(row.iv).toBeInstanceOf(Uint8Array);
    expect(row.iv.byteLength).toBe(12);
    expect(row.ciphertext).toBeInstanceOf(ArrayBuffer);

    const ciphertext = new Uint8Array(row.ciphertext);
    // AES-GCM: ciphertext = plaintext length + 16-byte tag.
    expect(ciphertext.byteLength).toBe(new TextEncoder().encode(SECRET).byteLength + 16);
    for (const bytes of [ciphertext, row.iv]) {
      expect(containsBytes(bytes, new TextEncoder().encode(SECRET))).toBe(false);
      expect(containsBytes(bytes, utf16(SECRET, true))).toBe(false);
      expect(containsBytes(bytes, utf16(SECRET, false))).toBe(false);
      // Also no long-enough fragment (first 6 chars) of the plaintext.
      expect(containsBytes(bytes, new TextEncoder().encode(SECRET.slice(0, 6)))).toBe(false);
    }
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(
      JSON.stringify(rows.map((r) => ({ ...r, ciphertext: Array.from(ciphertext) }))),
    ).not.toContain(SECRET);
  });

  it('uses the injected random source for the 96-bit IV', async () => {
    const random = vi.fn((a: Uint8Array) => a.fill(7));
    await createCredentialVault({ random }).put('secret-a', SECRET);
    expect(random).toHaveBeenCalledTimes(1);
    expect(random.mock.calls[0]![0].byteLength).toBe(12);
    const db = await rawDb();
    expect(Array.from((await db.secrets.get('secret-a'))!.iv)).toEqual(new Array(12).fill(7));
  });
});

describe('AC3 — round trip and unique IVs', () => {
  it('get returns the original secret; overwrite replaces it', async () => {
    const vault = createCredentialVault();
    await vault.put('secret-a', SECRET);
    expect(await vault.get('secret-a')).toBe(SECRET);
    await vault.put('secret-a', 'http://example.invalid/get.php?username=u&password=p');
    expect(await vault.get('secret-a')).toBe(
      'http://example.invalid/get.php?username=u&password=p',
    );
  });

  it('round-trips the empty string and long values', async () => {
    const vault = createCredentialVault();
    await vault.put('empty', '');
    expect(await vault.get('empty')).toBe('');
    const long = 'x'.repeat(10_000) + '🔑';
    await vault.put('long', long);
    expect(await vault.get('long')).toBe(long);
  });

  it('get of an unknown ref returns undefined', async () => {
    expect(await createCredentialVault().get('nope')).toBeUndefined();
  });

  it('1000 puts produce 1000 distinct IVs', async () => {
    const vault = createCredentialVault();
    const db = await rawDb();
    const ivs = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      await vault.put('same-ref', SECRET);
      ivs.add(hex((await db.secrets.get('same-ref'))!.iv));
    }
    expect(ivs.size).toBe(1000);
  });

  it('rejects an empty ref', async () => {
    const vault = createCredentialVault();
    await expect(vault.put('', SECRET)).rejects.toThrow(TypeError);
    await expect(vault.get('')).rejects.toThrow(TypeError);
    await expect(vault.delete('')).rejects.toThrow(TypeError);
  });
});

describe('integrity (AAD and tampering) → VaultKeyLostError(decrypt-failed)', () => {
  it('a ciphertext copied to another ref fails to decrypt (AAD = ref)', async () => {
    const vault = createCredentialVault();
    await vault.put('secret-a', SECRET);
    const db = await rawDb();
    const row = (await db.secrets.get('secret-a'))!;
    await db.secrets.put({ ...row, ref: 'secret-b' });
    await expectKeyLost(vault, 'secret-b', 'decrypt-failed');
    expect(await vault.get('secret-a')).toBe(SECRET);
  });

  it('a tampered ciphertext fails to decrypt', async () => {
    const vault = createCredentialVault();
    await vault.put('secret-a', SECRET);
    const db = await rawDb();
    const row = (await db.secrets.get('secret-a'))!;
    const tampered = new Uint8Array(row.ciphertext.slice(0));
    tampered[0]! ^= 0x01;
    await db.secrets.put({ ...row, ciphertext: tampered.buffer });
    await expectKeyLost(vault, 'secret-a', 'decrypt-failed');
  });

  it('a tampered IV fails to decrypt', async () => {
    const vault = createCredentialVault();
    await vault.put('secret-a', SECRET);
    const db = await rawDb();
    const row = (await db.secrets.get('secret-a'))!;
    const iv = row.iv.slice();
    iv[11]! ^= 0x80;
    await db.secrets.put({ ...row, iv });
    await expectKeyLost(vault, 'secret-a', 'decrypt-failed');
  });
});

describe('key loss', () => {
  it('ciphertext without a key → VaultKeyLostError(missing-key), never undefined', async () => {
    const vault = createCredentialVault();
    await vault.put('secret-a', SECRET);
    const db = await rawDb();
    await db.keys.clear();
    await expectKeyLost(vault, 'secret-a', 'missing-key');
    // get must not silently create a new key.
    expect(await db.keys.count()).toBe(0);
  });

  it('after key loss, put (re-enter password) creates a new key; old ciphertexts stay unreadable', async () => {
    const vault = createCredentialVault();
    await vault.put('secret-a', SECRET);
    await vault.put('secret-b', 'other-secret');
    const db = await rawDb();
    await db.keys.clear();

    await vault.put('secret-a', 're-entered-secret');
    expect(await db.keys.count()).toBe(1);
    expect(await vault.get('secret-a')).toBe('re-entered-secret');
    await expectKeyLost(vault, 'secret-b', 'decrypt-failed');
  });

  it('a different key (key replaced) → VaultKeyLostError(decrypt-failed)', async () => {
    const vault = createCredentialVault();
    await vault.put('secret-a', SECRET);
    const db = await rawDb();
    const [row] = await db.keys.toArray();
    const other = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await db.keys.put({ id: row!.id, key: other });
    await expectKeyLost(vault, 'secret-a', 'decrypt-failed');
  });
});

describe('concurrency', () => {
  it('simultaneous first-use puts create a single key', async () => {
    const { subtle, generateKey } = spySubtle();
    const vault = createCredentialVault({ subtle });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => vault.put(`secret-${i}`, `value-${i}-secret`)),
    );
    expect(generateKey).toHaveBeenCalledTimes(1);
    const db = await rawDb();
    expect(await db.keys.count()).toBe(1);
    for (let i = 0; i < 10; i += 1)
      expect(await vault.get(`secret-${i}`)).toBe(`value-${i}-secret`);
  });

  it('two instances (e.g. two tabs) racing on first use converge on one stored key', async () => {
    const first = createCredentialVault();
    const second = createCredentialVault();
    await Promise.all([
      first.put('secret-a', 'value-a-secret'),
      second.put('secret-b', 'value-b-secret'),
    ]);
    const db = await rawDb();
    expect(await db.keys.count()).toBe(1);
    expect(await first.get('secret-b')).toBe('value-b-secret');
    expect(await second.get('secret-a')).toBe('value-a-secret');
  });
});

describe('AC4 — wipe', () => {
  it('deletes the key and all secrets; the next put generates a new key', async () => {
    const { subtle, generateKey } = spySubtle();
    const vault = createCredentialVault({ subtle });
    await vault.put('secret-a', SECRET);
    await vault.put('secret-b', 'other-secret');
    await vault.wipe();

    const db = await rawDb();
    expect(await db.secrets.count()).toBe(0);
    expect(await db.keys.count()).toBe(0);
    expect(await vault.get('secret-a')).toBeUndefined();

    await vault.put('secret-a', 'fresh-secret');
    expect(generateKey).toHaveBeenCalledTimes(2);
    expect(await vault.get('secret-a')).toBe('fresh-secret');
  });

  it('unregisters the secrets it registered', async () => {
    const vault = createCredentialVault();
    await vault.put('secret-a', SECRET);
    await vault.put('secret-b', 'other-secret');
    await vault.wipe();
    expect(unregisterSecret).toHaveBeenCalledWith(SECRET);
    expect(unregisterSecret).toHaveBeenCalledWith('other-secret');
    expect(redact(`x ${SECRET} y`)).toBe(`x ${SECRET} y`);
  });
});

describe('log redaction', () => {
  it('put registers the secret before storing it', async () => {
    await createCredentialVault().put('secret-a', SECRET);
    expect(registerSecret).toHaveBeenCalledWith(SECRET);
    expect(redact(`password=${SECRET}`)).toBe(`password=${MASK}`);
  });

  it('get registers the decrypted secret (e.g. after a reload)', async () => {
    await createCredentialVault().put('secret-a', SECRET);
    clearSecrets();
    vi.mocked(registerSecret).mockClear();

    const reloaded = createCredentialVault();
    expect(await reloaded.get('secret-a')).toBe(SECRET);
    expect(registerSecret).toHaveBeenCalledWith(SECRET);
    expect(redact(SECRET)).toBe(MASK);
  });

  it('delete removes the secret and unregisters it', async () => {
    const vault = createCredentialVault();
    await vault.put('secret-a', SECRET);
    await vault.delete('secret-a');
    expect(await vault.get('secret-a')).toBeUndefined();
    const db = await rawDb();
    expect(await db.secrets.count()).toBe(0);
    expect(unregisterSecret).toHaveBeenCalledWith(SECRET);
    expect(redact(SECRET)).toBe(SECRET);
  });

  it('delete keeps redacting a value still stored under another ref', async () => {
    const vault = createCredentialVault();
    await vault.put('secret-a', SECRET);
    await vault.put('secret-b', SECRET);
    await vault.delete('secret-a');
    expect(unregisterSecret).not.toHaveBeenCalled();
    expect(redact(SECRET)).toBe(MASK);
    await vault.delete('secret-b');
    expect(unregisterSecret).toHaveBeenCalledWith(SECRET);
  });

  it('delete of an unknown ref is a no-op', async () => {
    await expect(createCredentialVault().delete('nope')).resolves.toBeUndefined();
    expect(unregisterSecret).not.toHaveBeenCalled();
  });
});

describe('default instance', () => {
  it('credentialVault works with the global WebCrypto', async () => {
    await credentialVault.put('secret-default', SECRET);
    expect(await credentialVault.get('secret-default')).toBe(SECRET);
    await credentialVault.wipe();
    expect(await credentialVault.get('secret-default')).toBeUndefined();
  });
});
