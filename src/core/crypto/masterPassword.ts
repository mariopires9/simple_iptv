// Master password key derivation and verifier (SEC-02, ADR-006).
// - KDF: PBKDF2-SHA-256, random 128-bit salt, at least MIN_PBKDF2_ITERATIONS (600 000) iterations,
//   into a non-extractable AES-GCM 256 key. The key and the password are never persisted.
// - What is persisted (`settings.masterPassword`): version, iteration count, salt, the key id
//   (`kid`, random, tags the secrets encrypted with this key) and a verifier: a known constant
//   encrypted with the key (AES-GCM, random IV, additional data = the kid). A wrong password fails
//   the verifier's authentication. The verifier lets an attacker test guesses offline, exactly as
//   the encrypted secrets themselves would; the iteration count is what slows that down.
import { log } from '@/core/log';
import { MASTER_KID_PREFIX, type MasterKey } from './lockState';
import {
  base64ToBytes,
  bytesToBase64,
  derivePasswordKey,
  MAX_PBKDF2_ITERATIONS,
  MIN_PBKDF2_ITERATIONS,
} from './passwordCipher';

export interface MasterPasswordConfig {
  version: 1;
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  /** base64, 16 bytes. */
  salt: string;
  /** `master:<hex>`: the `kid` of every secret encrypted with this key. */
  kid: string;
  verifier: {
    /** base64, 12 bytes. */
    iv: string;
    /** base64 (includes the GCM tag). */
    ciphertext: string;
  };
}

/** The password does not open the stored verifier (or the verifier was altered). */
export class WrongMasterPasswordError extends Error {
  override readonly name = 'WrongMasterPasswordError';
  constructor() {
    super('The master password is not correct');
  }
}

export interface MasterPasswordDeps {
  subtle?: SubtleCrypto;
  random?: (a: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
}

const SALT_BYTES = 16;
const IV_BYTES = 12;
const KID_BYTES = 16;
const VERIFIER_TEXT = 'simple-iptv/master-password/verifier/v1';
const USAGES: KeyUsage[] = ['encrypt', 'decrypt'];
const encoder = new TextEncoder();

function resolve(deps: MasterPasswordDeps) {
  return {
    subtle: deps.subtle ?? globalThis.crypto.subtle,
    random: deps.random ?? ((a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a)),
  };
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Derives a new key from `password` (new salt and kid) and the config that describes it. */
export async function createMasterPassword(
  password: string,
  deps: MasterPasswordDeps = {},
): Promise<{ config: MasterPasswordConfig; key: MasterKey }> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('createMasterPassword: the password must be a non-empty string');
  }
  const { subtle, random } = resolve(deps);
  const salt = random(new Uint8Array(SALT_BYTES));
  const iv = random(new Uint8Array(IV_BYTES));
  const kid = MASTER_KID_PREFIX + toHex(random(new Uint8Array(KID_BYTES)));
  const iterations = MIN_PBKDF2_ITERATIONS;
  const key = await derivePasswordKey(password, salt, iterations, USAGES, subtle);
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(kid) },
    key,
    encoder.encode(VERIFIER_TEXT),
  );
  return {
    config: {
      version: 1,
      kdf: 'PBKDF2-SHA-256',
      iterations,
      salt: bytesToBase64(salt),
      kid,
      verifier: { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) },
    },
    key: { kid, key },
  };
}

/** The stored config if it is well formed, else `undefined` (untrusted settings value). */
export function parseMasterPasswordConfig(value: unknown): MasterPasswordConfig | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const v = value as Partial<Record<keyof MasterPasswordConfig, unknown>>;
  const verifier = v.verifier as { iv?: unknown; ciphertext?: unknown } | null | undefined;
  const ok =
    v.version === 1 &&
    v.kdf === 'PBKDF2-SHA-256' &&
    typeof v.iterations === 'number' &&
    Number.isInteger(v.iterations) &&
    v.iterations >= MIN_PBKDF2_ITERATIONS &&
    v.iterations <= MAX_PBKDF2_ITERATIONS &&
    typeof v.salt === 'string' &&
    typeof v.kid === 'string' &&
    v.kid.startsWith(MASTER_KID_PREFIX) &&
    v.kid.length > MASTER_KID_PREFIX.length &&
    verifier !== null &&
    typeof verifier === 'object' &&
    typeof verifier.iv === 'string' &&
    typeof verifier.ciphertext === 'string';
  if (!ok) return undefined;
  return {
    version: 1,
    kdf: 'PBKDF2-SHA-256',
    iterations: v.iterations as number,
    salt: v.salt as string,
    kid: v.kid as string,
    verifier: { iv: verifier.iv as string, ciphertext: verifier.ciphertext as string },
  };
}

/** Derives the key from `password` and checks it against the verifier. */
export async function openMasterPassword(
  config: MasterPasswordConfig,
  password: string,
  deps: MasterPasswordDeps = {},
): Promise<MasterKey> {
  const { subtle } = resolve(deps);
  let salt: Uint8Array<ArrayBuffer>;
  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    salt = base64ToBytes(config.salt);
    iv = base64ToBytes(config.verifier.iv);
    ciphertext = base64ToBytes(config.verifier.ciphertext);
  } catch {
    throw new WrongMasterPasswordError();
  }
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw new WrongMasterPasswordError();
  const key = await derivePasswordKey(password, salt, config.iterations, USAGES, subtle);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(config.kid) },
      key,
      ciphertext,
    );
  } catch {
    log.info('master password: verification failed');
    throw new WrongMasterPasswordError();
  }
  if (new TextDecoder().decode(plaintext) !== VERIFIER_TEXT) throw new WrongMasterPasswordError();
  return { kid: config.kid, key };
}
