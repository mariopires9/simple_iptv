// Password-based encryption (EXP-01): encrypts a UTF-8 text with a key derived from a password the
// user types, for data that leaves the device (the export file's secrets). Everything goes through
// WebCrypto:
// - KDF: PBKDF2-SHA-256 with a random 128-bit salt per encryption and at least
//   `MIN_PBKDF2_ITERATIONS` iterations (OWASP 2023 recommendation, ADR-006 / SEC-02).
// - Cipher: AES-GCM 256 with a random 96-bit IV; `aad` (optional, not secret) is authenticated.
// - The derived key is non-extractable and never persisted; the device key (CredentialVault) is
//   never involved.
// The envelope only holds non-secret parameters (salt, IV, iteration count) and the ciphertext.
// A wrong password and a tampered envelope are indistinguishable by design: both reject with
// `PasswordDecryptError`.

export const MIN_PBKDF2_ITERATIONS = 600_000;
/** Upper bound accepted when decrypting an untrusted envelope (bounds the work an import costs). */
export const MAX_PBKDF2_ITERATIONS = 5_000_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface PasswordEnvelope {
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  /** base64 */
  salt: string;
  cipher: 'AES-GCM-256';
  /** base64 */
  iv: string;
  /** base64 (includes the GCM tag). */
  ciphertext: string;
}

export interface PasswordCipherDeps {
  subtle?: SubtleCrypto;
  random?: (a: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
}

/** Wrong password, or the envelope/ciphertext/additional data was altered. */
export class PasswordDecryptError extends Error {
  override readonly name = 'PasswordDecryptError';
  constructor(options?: { cause?: unknown }) {
    super('The data could not be decrypted (wrong password or damaged data)', options);
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Throws `PasswordDecryptError` on anything that is not base64. */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(text);
  } catch (error) {
    throw new PasswordDecryptError({ cause: error });
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const encoder = new TextEncoder();

/**
 * PBKDF2-SHA-256 → non-extractable AES-GCM 256 key with the given usages (also the master password
 * key of SEC-02). The caller enforces the iteration bounds.
 */
export async function derivePasswordKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usages: KeyUsage[],
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<CryptoKey> {
  const material = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

function deriveKey(
  subtle: SubtleCrypto,
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usage: KeyUsage,
): Promise<CryptoKey> {
  return derivePasswordKey(password, salt, iterations, [usage], subtle);
}

function deps(d: PasswordCipherDeps) {
  return {
    subtle: d.subtle ?? globalThis.crypto.subtle,
    random: d.random ?? ((a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a)),
  };
}

export async function encryptWithPassword(
  plaintext: string,
  password: string,
  options: { aad?: string; iterations?: number } & PasswordCipherDeps = {},
): Promise<PasswordEnvelope> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('encryptWithPassword: the password must be a non-empty string');
  }
  const iterations = options.iterations ?? MIN_PBKDF2_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS) {
    throw new RangeError(`encryptWithPassword: at least ${MIN_PBKDF2_ITERATIONS} iterations`);
  }
  const { subtle, random } = deps(options);
  const salt = random(new Uint8Array(SALT_BYTES));
  const iv = random(new Uint8Array(IV_BYTES));
  const key = await deriveKey(subtle, password, salt, iterations, 'encrypt');
  const ciphertext = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      ...(options.aad !== undefined ? { additionalData: encoder.encode(options.aad) } : {}),
    },
    key,
    encoder.encode(plaintext),
  );
  return {
    kdf: 'PBKDF2-SHA-256',
    iterations,
    salt: bytesToBase64(salt),
    cipher: 'AES-GCM-256',
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptWithPassword(
  envelope: PasswordEnvelope,
  password: string,
  options: { aad?: string } & PasswordCipherDeps = {},
): Promise<string> {
  const { iterations } = envelope;
  if (
    envelope.kdf !== 'PBKDF2-SHA-256' ||
    envelope.cipher !== 'AES-GCM-256' ||
    !Number.isInteger(iterations) ||
    iterations < MIN_PBKDF2_ITERATIONS ||
    iterations > MAX_PBKDF2_ITERATIONS
  ) {
    throw new PasswordDecryptError();
  }
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw new PasswordDecryptError();
  const { subtle } = deps(options);
  try {
    const key = await deriveKey(subtle, password, salt, iterations, 'decrypt');
    const plaintext = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        ...(options.aad !== undefined ? { additionalData: encoder.encode(options.aad) } : {}),
      },
      key,
      ciphertext,
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch (error) {
    throw new PasswordDecryptError({ cause: error });
  }
}
