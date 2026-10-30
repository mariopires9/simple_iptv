// Parental control (SEC-03): a 4–8 digit PIN and the categories it restricts. Framework-agnostic
// store; the UI subscribes with `useSyncExternalStore`.
//
// - Stored in the `parentalControl` setting: a random salt and the PBKDF2/SHA-256 hash of the PIN
//   (never the PIN), the iteration count, and the restricted category keys (every list, every
//   type). Untrusted on read: an invalid value counts as "no PIN".
// - Unlocking is per session: kept in memory only, so it lasts until the app is closed (or the
//   page reloaded) or `lockParental` is called. Setting the PIN unlocks (the user just typed it).
// - Screens hide `locked` (= restricted while locked) categories and their items.
// It is a deterrent, not strong protection: a 4–8 digit PIN hash can be brute-forced offline by
// anyone with access to the device's storage, and the data can always be deleted.
//
// `@/core/db` (Dexie) is imported dynamically: modules that reach this one from the initial
// bundle must not pull it in.

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
/** PBKDF2 iterations of new hashes (stored with the hash, so it can change later). */
export const PIN_HASH_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

export interface ParentalSnapshot {
  /** Whether the setting has been read. */
  readonly known: boolean;
  /** A PIN is set (parental control is on). */
  readonly pinSet: boolean;
  /** The PIN was entered in this session (and not locked again since). */
  readonly unlocked: boolean;
  /** Restricted category keys (all lists and types). */
  readonly restricted: ReadonlySet<string>;
  /** What screens hide now: the restricted keys while locked, else none. */
  readonly locked: ReadonlySet<string>;
}

/** Stored shape of the `parentalControl` setting. */
interface StoredParental {
  version: 1;
  salt: string;
  hash: string;
  iterations: number;
  restricted: string[];
}

/** The PIN entered does not match the stored one. */
export class WrongPinError extends Error {
  constructor() {
    super('Wrong PIN');
    this.name = 'WrongPinError';
  }
}

/** The PIN is not 4–8 digits. */
export class InvalidPinError extends Error {
  constructor() {
    super('The PIN must have 4 to 8 digits');
    this.name = 'InvalidPinError';
  }
}

/** A change that needs the PIN entered first (restrictions edited while locked or without PIN). */
export class ParentalLockedError extends Error {
  constructor() {
    super('Parental control is locked');
    this.name = 'ParentalLockedError';
  }
}

const EMPTY: ReadonlySet<string> = new Set();
const UNKNOWN: ParentalSnapshot = {
  known: false,
  pinSet: false,
  unlocked: false,
  restricted: EMPTY,
  locked: EMPTY,
};

let snapshot: ParentalSnapshot = UNKNOWN;
let stored: StoredParental | undefined;
let unlocked = false;
let reading: Promise<ParentalSnapshot> | undefined;
let iterations = PIN_HASH_ITERATIONS;
const listeners = new Set<() => void>();

function publish(): ParentalSnapshot {
  const restricted: ReadonlySet<string> = stored ? new Set(stored.restricted) : EMPTY;
  const isUnlocked = stored !== undefined && unlocked;
  snapshot = {
    known: true,
    pinSet: stored !== undefined,
    unlocked: isUnlocked,
    restricted,
    locked: stored && !isUnlocked ? restricted : EMPTY,
  };
  for (const listener of listeners) listener();
  return snapshot;
}

export function getParentalSnapshot(): ParentalSnapshot {
  return snapshot;
}

export function subscribeParental(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether a PIN has the accepted form: 4 to 8 ASCII digits. */
export function isValidPin(pin: string): boolean {
  return new RegExp(`^[0-9]{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

/** Whether `categoryKey` is hidden now (restricted and locked). */
export function isCategoryLocked(
  categoryKey: string | undefined,
  current: ParentalSnapshot = snapshot,
): boolean {
  return categoryKey !== undefined && current.locked.has(categoryKey);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseStored(value: unknown): StoredParental | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return undefined;
  if (typeof v.salt !== 'string' || typeof v.hash !== 'string') return undefined;
  if (typeof v.iterations !== 'number' || !Number.isInteger(v.iterations) || v.iterations < 1) {
    return undefined;
  }
  try {
    if (fromBase64(v.salt).length === 0 || fromBase64(v.hash).length !== HASH_BITS / 8) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  const restricted = Array.isArray(v.restricted)
    ? [...new Set(v.restricted.filter((k): k is string => typeof k === 'string' && k !== ''))]
    : [];
  return { version: 1, salt: v.salt, hash: v.hash, iterations: v.iterations, restricted };
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, rounds: number): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds },
    material,
    HASH_BITS,
  );
  return toBase64(new Uint8Array(bits));
}

/** Constant-time comparison of two base64 hashes. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function matches(config: StoredParental, pin: string): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  return sameHash(await derive(pin, fromBase64(config.salt), config.iterations), config.hash);
}

async function settings() {
  return (await import('@/core/db')).settingsRepo;
}

async function write(next: StoredParental | undefined): Promise<void> {
  const repo = await settings();
  if (next) await repo.set('parentalControl', next);
  else await repo.remove('parentalControl');
  stored = next;
}

/** Reads the setting once (later calls reuse the answer) and publishes it. */
export function loadParentalControl(): Promise<ParentalSnapshot> {
  if (snapshot.known) return Promise.resolve(snapshot);
  reading ??= settings()
    .then((repo) => repo.get('parentalControl'))
    .then(
      (value) => {
        // A write settled meanwhile: it is newer than this read.
        if (!snapshot.known) stored = parseStored(value);
        return snapshot.known ? snapshot : publish();
      },
      (error: unknown) => {
        reading = undefined;
        throw error;
      },
    );
  return reading;
}

async function current(): Promise<StoredParental | undefined> {
  await loadParentalControl();
  return stored;
}

/** Checks the PIN; when right, unlocks restricted content for this session. */
export async function unlockParental(pin: string): Promise<boolean> {
  const config = await current();
  if (!config) return true;
  if (!(await matches(config, pin))) return false;
  unlocked = true;
  publish();
  return true;
}

/** Locks restricted content again (until the PIN is entered). */
export function lockParental(): void {
  if (!unlocked) return;
  unlocked = false;
  if (snapshot.known) publish();
}

/**
 * Sets a new PIN. When one is already set, `currentPin` must match it (change PIN). The
 * restrictions are kept and the session is unlocked.
 */
export async function setParentalPin(pin: string, currentPin?: string): Promise<void> {
  if (!isValidPin(pin)) throw new InvalidPinError();
  const config = await current();
  if (config && !(await matches(config, currentPin ?? ''))) throw new WrongPinError();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  await write({
    version: 1,
    salt: toBase64(salt),
    hash: await derive(pin, salt, iterations),
    iterations,
    restricted: config?.restricted ?? [],
  });
  unlocked = true;
  publish();
}

/** Removes the PIN and every restriction; `currentPin` must match. */
export async function removeParentalPin(currentPin: string): Promise<void> {
  const config = await current();
  if (!config) return;
  if (!(await matches(config, currentPin))) throw new WrongPinError();
  await write(undefined);
  unlocked = false;
  publish();
}

/**
 * Replaces the restricted categories that start with `prefix` (one list and type:
 * `typePrefix(sourceId, type)`) by `keys`; the others are kept. Needs a PIN set and unlocked.
 */
export async function setRestrictedCategories(
  prefix: string,
  keys: readonly string[],
): Promise<void> {
  const config = await current();
  if (!config || !unlocked) throw new ParentalLockedError();
  const kept = config.restricted.filter((key) => !key.startsWith(prefix));
  const added = keys.filter((key) => key.startsWith(prefix));
  await write({ ...config, restricted: [...new Set([...kept, ...added])] });
  publish();
}

/** Tests only: forgets the session state (as after a reload) and optionally speeds hashing up. */
export function resetParentalForTests(options: { iterations?: number } = {}): void {
  snapshot = UNKNOWN;
  stored = undefined;
  unlocked = false;
  reading = undefined;
  iterations = options.iterations ?? PIN_HASH_ITERATIONS;
  listeners.clear();
}
