// Opening, closing and deleting the database. Internal module of core/db:
// features only use the repositories exported by `./index.ts`.
//
// Note on downgrade: if the installed database has a higher version (created by a newer version
// of the app), Dexie 4 does not reject with VersionError — it opens it at the existing version and
// creates the missing tables (upgrading the version if needed). That is why there is no "version"
// reason in `DatabaseUnavailableReason`; a residual VersionError falls into 'open-failed'.
import { SimpleIptvDb } from './schema';

/** Technical reason; the UI turns it into text (src/i18n/en/db.ts, ADR-015). */
export type DatabaseUnavailableReason = 'unsupported' | 'open-failed' | 'timeout';

/** IndexedDB unavailable or inaccessible. The message is diagnostic, not for the UI. */
export class DatabaseUnavailableError extends Error {
  override readonly name = 'DatabaseUnavailableError';
  readonly reason: DatabaseUnavailableReason;

  constructor(reason: DatabaseUnavailableReason, options?: { cause?: unknown }) {
    super(`IndexedDB unavailable (${reason})`, options);
    this.reason = reason;
  }
}

/** The pending open was cancelled by `closeDatabase()`/`wipeAll()`. */
export class DatabaseClosedError extends Error {
  override readonly name = 'DatabaseClosedError';

  constructor() {
    super('Database closed while opening');
  }
}

/**
 * The database is locked because all data is being (or was) deleted (SRC-10): it is not reopened
 * until the page reloads, so a mounted screen cannot recreate it or write to it.
 */
export class DatabaseLockedError extends Error {
  override readonly name = 'DatabaseLockedError';

  constructor() {
    super('Database locked (all data deleted)');
  }
}

export interface OpenDatabaseOptions {
  /** Alternative factory (tests with fake-indexeddb). Defaults to `globalThis.indexedDB`. */
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
  /** Maximum time to open (ms) before giving up. Defaults to 10 s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

let current: SimpleIptvDb | undefined;
let lastOptions: OpenDatabaseOptions = {};
let opening: Promise<SimpleIptvDb> | undefined;
/** Incremented on every close/wipe: an open from a previous generation never ends up in `current`. */
let generation = 0;
/** Set by `lockDatabase()` (or a deletion from another tab): no open until `unlockDatabase()`. */
let locked = false;
/**
 * `wipeAll()` calls of this JS realm in progress: their `versionchange` is not a deletion by
 * another tab. Kept on `globalThis` so every instance of this module in the realm shares it (one
 * per realm in the app; tests may load the module twice).
 */
const ownDeletions: { count: number } = ((globalThis as Record<symbol, unknown>)[
  Symbol.for('simple-iptv.db.ownDeletions')
] ??= { count: 0 }) as { count: number };

function classify(error: unknown): DatabaseUnavailableReason {
  return error instanceof Error && error.name === 'MissingAPIError' ? 'unsupported' : 'open-failed';
}

/**
 * Rejects with `DatabaseUnavailableError('timeout')` when `promise` has not settled within `ms`
 * (the promise itself keeps running).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DatabaseUnavailableError('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function createDb(options: OpenDatabaseOptions): SimpleIptvDb {
  if (options.indexedDB === undefined) return new SimpleIptvDb();
  return new SimpleIptvDb({
    indexedDB: options.indexedDB,
    ...(options.IDBKeyRange ? { IDBKeyRange: options.IDBKeyRange } : {}),
  });
}

async function doOpen(options: OpenDatabaseOptions, gen: number): Promise<SimpleIptvDb> {
  let db: SimpleIptvDb | undefined;
  try {
    db = createDb(options);
    await withTimeout(db.open(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } catch (error) {
    db?.close();
    if (gen !== generation) throw new DatabaseClosedError();
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError(classify(error), { cause: error });
  }
  if (gen !== generation) {
    // closeDatabase()/wipeAll() happened in the meantime: this connection must not survive.
    db.close();
    throw new DatabaseClosedError();
  }
  const opened = db;
  // Unexpected close: the next call reopens it.
  opened.on('close', () => {
    if (current === opened) current = undefined;
  });
  // Another tab deletes the database ("Delete all data", SRC-10): Dexie closes this connection;
  // it must not be reopened (it would recreate the database) until this page reloads. A deletion by
  // this context's own `wipeAll()` (racing a late open) is not one: it locks explicitly if needed.
  opened.on('versionchange', (event: IDBVersionChangeEvent) => {
    if (event.newVersion === null && ownDeletions.count === 0) locked = true;
  });
  current = opened;
  return opened;
}

/**
 * Opens (or returns the already open) `simple-iptv` v1 database.
 * Rejects with `DatabaseUnavailableError` if IndexedDB is not available.
 * Options only take effect on the first open (or after `closeDatabase()`).
 */
export function openDatabase(options: OpenDatabaseOptions = {}): Promise<SimpleIptvDb> {
  if (locked) return Promise.reject(new DatabaseLockedError());
  if (current) return Promise.resolve(current);
  if (!opening) {
    lastOptions = options;
    const promise: Promise<SimpleIptvDb> = doOpen(options, generation).finally(() => {
      if (opening === promise) opening = undefined;
    });
    opening = promise;
  }
  return opening;
}

/**
 * Closes the current connection and cancels a pending open (that connection is closed as soon
 * as it completes and the promise rejects with `DatabaseClosedError`). Resolves when nothing is
 * left open.
 */
export async function closeDatabase(): Promise<void> {
  generation += 1;
  const pending = opening;
  opening = undefined;
  current?.close();
  current = undefined;
  if (pending) await pending.catch(() => undefined);
}

/**
 * SRC-10: closes the database and refuses to open it again (`DatabaseLockedError`) until
 * `unlockDatabase()` or a page reload. `wipeAll()` still works while locked.
 */
export async function lockDatabase(): Promise<void> {
  locked = true;
  await closeDatabase();
}

/** Lifts `lockDatabase()` (the deletion failed and the data is still there; tests). */
export function unlockDatabase(): void {
  locked = false;
}

export function isDatabaseLocked(): boolean {
  return locked;
}

/** Deletes the whole database (SRC-10 "Delete all data"). */
export async function wipeAll(): Promise<void> {
  ownDeletions.count += 1;
  try {
    await closeDatabase();
    await createDb(lastOptions).delete();
  } finally {
    ownDeletions.count -= 1;
  }
}

/** Used by the repositories: opens the database if it is not open yet. */
export function getDb(): Promise<SimpleIptvDb> {
  return openDatabase();
}
