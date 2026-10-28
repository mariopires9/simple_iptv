// Xtream catalogue sync (SRC-07, ARCHITECTURE.md §6.1, ADR-009). Runs inside the data worker.
//
// Flow: source → vault (password) → auth → for each type: categories, items (JSON.parse happens
// here, in the worker) → tolerant validation → one catalogue transaction per type → source
// status/stats.
//
// Credentials: the password is read from the vault *inside the worker* (IndexedDB and WebCrypto
// are available in dedicated workers), so it never crosses postMessage. The task input/output and
// every progress message carry only ids, counts and phase names.
//
// Concurrency: syncs of the same source are serialised (per-source queue in this module, i.e. per
// worker); a waiting sync can still be cancelled. Syncs of different sources run interleaved.
//
// Failures:
// - Fatal (`auth`, `account-inactive`, `credentials-lost`, or any failure before/at the auth step,
//   or a 401/403 in a later call): stops the sync, marks every type not yet written with the code,
//   sets `lastSyncStatus: 'error'` without advancing `lastSyncAt` (so `isSyncDue` retries), and
//   the task rejects with `WorkerTaskError('failed', 'Xtream sync failed (<code>)')`. Types
//   committed before the failure keep their per-type `ok` entry and their new data.
// - Server unreachable after auth (`offline`, `timeout`, `blocked` on any call): that type gets its
//   code, the remaining types are not attempted and get `server-unreachable`; the sync returns.
// - Any other failure is per type: that type keeps its previous data (its transaction never ran),
//   the others are written, and the result/source record the error per type (status `partial`).
// - Empty list rule: an items response of `[]` replaces stored data only when (a) the type had no
//   stored items before, or (b) the categories response for that type is also `[]` (both calls
//   answered 200 — an empty panel section). Otherwise it is treated as suspicious (`empty-response`)
//   and the previous data is kept.
// - Source removed during the sync: the existence check runs inside each write transaction; the
//   sync stops without writing anything (`WorkerTaskError('cancelled', '… (source-removed)')`).
// - Cancellation is checked between phases and before each write; an in-flight request is
//   aborted. Types already written stay written (each is complete and consistent); the others keep
//   their previous data; the overall status and `lastSyncAt` are left untouched.
import {
  CONTENT_TYPES,
  catalogRepo,
  isContentType,
  sourcesRepo,
  type CatalogItemInput,
  type ContentType,
  type Source,
  type SourceStats,
  type TypeSyncStatus,
} from '@/core/db';
import { credentialVault, VaultKeyLostError, type CredentialVault } from '@/core/crypto';
import { log } from '@/core/log';
import { NetError, type FetchImpl } from '@/core/net';
import { WorkerTaskError, type TaskContext } from '@/core/worker';
import {
  XTREAM_CATALOG_ACTIONS,
  mapCategories,
  mapLiveStreams,
  mapSeries,
  mapVodStreams,
  type MapOptions,
  type Mapped,
} from './catalog';
import { createXtreamClient, type XtreamClientOptions } from './client';

/** Progress phases, in order. Progress messages contain only these names and counts. */
export type XtreamSyncPhase =
  | 'auth'
  | 'live-categories'
  | 'live'
  | 'movie-categories'
  | 'movie'
  | 'series-categories'
  | 'series'
  | 'done';

export interface SyncXtreamInput {
  sourceId: string;
  /** Types to sync; default all three. Unknown values are ignored. */
  types?: readonly ContentType[];
}

/**
 * Error codes recorded per type / on the source. `NetErrorKind`s (`offline`, `timeout`,
 * `blocked`, `http`, `auth`, `parse`, `aborted`) plus:
 * - `account-inactive`: authenticated but the account is not `Active` (expired, banned…)
 * - `invalid-response`: the list is not an array, or none of its entries is valid
 * - `empty-response`: `[]` for a type that has stored items (see the empty list rule)
 * - `server-unreachable`: not attempted because an earlier call could not reach the server
 * - `storage`: writing to IndexedDB failed (e.g. quota)
 * - `credentials-lost`: the vault cannot decrypt the password (user must re-enter it)
 * - `unknown`
 */
export type XtreamSyncErrorCode =
  | NetError['kind']
  | 'account-inactive'
  | 'invalid-response'
  | 'empty-response'
  | 'server-unreachable'
  | 'storage'
  | 'credentials-lost'
  | 'unknown';

export interface SyncXtreamResult {
  sourceId: string;
  /** `ok`: every requested type written; `partial`: some; `error`: none. */
  status: 'ok' | 'partial' | 'error';
  types: Partial<Record<ContentType, TypeSyncStatus>>;
  /** Real stored counts after the sync. */
  stats: SourceStats;
}

/** Injectable dependencies (tests). */
export interface SyncXtreamDeps {
  vault?: CredentialVault;
  fetchImpl?: FetchImpl;
  now?: () => number;
  /** Timeout of the auth and categories requests. Default {@link CATEGORIES_TIMEOUT_MS}. */
  categoriesTimeoutMs?: number;
  /** Timeout of the item lists (can be tens of MB). Default {@link ITEMS_TIMEOUT_MS}. */
  itemsTimeoutMs?: number;
  /** How often an in-flight request / a queued sync checks for cancellation (ms). Default 50. */
  cancelPollMs?: number;
}

export const CATEGORIES_TIMEOUT_MS = 30_000;
export const ITEMS_TIMEOUT_MS = 120_000;

/** Codes that make the rest of the sync pointless: stop everything and reject. */
const FATAL_CODES: ReadonlySet<XtreamSyncErrorCode> = new Set([
  'auth',
  'account-inactive',
  'credentials-lost',
]);

/** The server stopped answering: do not wait for a timeout on every remaining call. */
const UNREACHABLE_CODES: ReadonlySet<XtreamSyncErrorCode> = new Set([
  'offline',
  'timeout',
  'blocked',
]);

class SyncTypeError extends Error {
  override readonly name = 'SyncTypeError';
  constructor(readonly code: XtreamSyncErrorCode) {
    super(`Xtream sync step failed (${code})`);
  }
}

class SourceRemovedError extends Error {
  override readonly name = 'SourceRemovedError';
}

function errorCode(err: unknown): { code: XtreamSyncErrorCode; httpStatus?: number } {
  if (err instanceof SyncTypeError) return { code: err.code };
  if (err instanceof NetError) {
    return err.status !== undefined && err.kind === 'http'
      ? { code: 'http', httpStatus: err.status }
      : { code: err.kind };
  }
  if (err instanceof VaultKeyLostError) return { code: 'credentials-lost' };
  return { code: 'unknown' };
}

/** Accepts only a JSON array; anything else (object, null, HTML…) is an invalid response. */
function asList(body: unknown): readonly unknown[] {
  if (Array.isArray(body)) return body as unknown[];
  throw new SyncTypeError('invalid-response');
}

/**
 * Rejects stored image URLs that embed the account credentials (ARCHITECTURE.md §5): credential
 * query parameters, the password anywhere (when it is long enough to match reliably), or else the
 * `/user/pass/` path form.
 */
export function credentialFreeUrl(username: string, password: string): (href: string) => boolean {
  return (href) => {
    let text = href;
    try {
      text = decodeURIComponent(href);
    } catch {
      // Keep the raw form.
    }
    if (/[?&](username|password|token)=/i.test(text)) return false;
    return password.length >= 4
      ? !text.includes(password)
      : !text.includes(`/${username}/${password}/`);
  };
}

function requestedTypes(types: readonly ContentType[] | undefined): ContentType[] {
  if (types === undefined) return [...CONTENT_TYPES];
  const wanted = new Set(types.filter((t) => typeof t === 'string' && isContentType(t)));
  return CONTENT_TYPES.filter((t) => wanted.has(t));
}

function mapItems(
  type: ContentType,
  list: readonly unknown[],
  options: MapOptions,
): Mapped<CatalogItemInput<ContentType>> {
  switch (type) {
    case 'live':
      return mapLiveStreams(list, options);
    case 'movie':
      return mapVodStreams(list, options);
    case 'series':
      return mapSeries(list, options);
  }
}

async function storedStats(sourceId: string): Promise<SourceStats> {
  const [live, movies, series] = await Promise.all([
    catalogRepo.count(sourceId, 'live'),
    catalogRepo.count(sourceId, 'movie'),
    catalogRepo.count(sourceId, 'series'),
  ]);
  return { live, movies, series };
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// Per-source queue
// ---------------------------------------------------------------------------------------------

/** Tail of each source's queue; resolves when every queued sync of that source has finished. */
const queues = new Map<string, Promise<void>>();

/**
 * Waits for the previous syncs of `sourceId` to finish, then holds the source until `release()`.
 * A cancellation while waiting gives up the place in the queue and throws.
 */
async function acquireSource(
  sourceId: string,
  ctx: TaskContext,
  pollMs: number,
): Promise<() => void> {
  const previous = queues.get(sourceId) ?? Promise.resolve();
  let unlock = () => {};
  const mine = new Promise<void>((resolve) => (unlock = resolve));
  const tail = previous.then(() => mine);
  queues.set(sourceId, tail);
  const release = () => {
    unlock();
    if (queues.get(sourceId) === tail) queues.delete(sourceId);
  };
  let ready = false;
  void previous.then(() => (ready = true));
  await Promise.resolve();
  while (!ready) {
    if (ctx.cancelled) {
      release();
      ctx.throwIfCancelled();
    }
    await Promise.race([previous, pause(pollMs)]);
  }
  return release;
}

/** Whether a sync of `sourceId` is running or queued in this worker. */
export function isSourceSyncing(sourceId: string): boolean {
  return queues.has(sourceId);
}

/** Resolves when no sync of `sourceId` is running or queued in this worker. */
export async function waitForSourceIdle(sourceId: string): Promise<void> {
  for (let tail = queues.get(sourceId); tail; tail = queues.get(sourceId)) await tail;
}

// ---------------------------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------------------------

/**
 * Syncs the catalogue of an Xtream source into IndexedDB. Must run in the data worker
 * (registered as task `syncXtream` in src/worker/tasks.ts); also callable directly in tests.
 */
export async function syncXtreamSource(
  input: SyncXtreamInput,
  ctx: TaskContext,
  deps: SyncXtreamDeps = {},
): Promise<SyncXtreamResult> {
  const types = requestedTypes(input.types);
  const { sourceId } = input;
  const pollMs = deps.cancelPollMs ?? 50;

  ctx.throwIfCancelled();
  if (typeof sourceId !== 'string' || sourceId === '') {
    throw new WorkerTaskError('failed', 'Xtream sync: source not found');
  }
  if (types.length === 0) throw new WorkerTaskError('failed', 'Xtream sync: no content types');

  const release = await acquireSource(sourceId, ctx, pollMs);
  try {
    return await runSync(sourceId, types, ctx, deps, pollMs);
  } catch (err) {
    if (err instanceof SourceRemovedError) {
      log.info('xtream sync: source removed during sync', { sourceId });
      throw new WorkerTaskError('cancelled', 'Xtream sync stopped (source-removed)');
    }
    throw err;
  } finally {
    release();
  }
}

async function runSync(
  sourceId: string,
  types: ContentType[],
  ctx: TaskContext,
  deps: SyncXtreamDeps,
  pollMs: number,
): Promise<SyncXtreamResult> {
  const vault = deps.vault ?? credentialVault;
  const now = deps.now ?? Date.now;

  ctx.throwIfCancelled();
  ctx.progress({ phase: 'auth', done: 0 });

  const source = await sourcesRepo.get(sourceId);
  if (!source) throw new WorkerTaskError('failed', 'Xtream sync: source not found');
  if (source.kind !== 'xtream') {
    throw new WorkerTaskError('failed', 'Xtream sync: not an Xtream source');
  }
  if (!source.serverUrl || !source.username || !source.secretRef) {
    throw new WorkerTaskError('failed', 'Xtream sync: source has no credentials');
  }
  const { serverUrl, username, secretRef } = source;

  const outcomes: Partial<Record<ContentType, TypeSyncStatus>> = {};
  const startedAt = now();

  /**
   * Persists per-type outcomes (merged into the *current* source row, only for the types this run
   * attempted), real stored counts and, depending on `mode`, the overall status.
   */
  async function finish(
    mode: 'complete' | 'fatal' | 'cancelled',
    fatalCode?: XtreamSyncErrorCode,
  ): Promise<SyncXtreamResult> {
    const current = await sourcesRepo.get(sourceId);
    if (!current) throw new SourceRemovedError();
    const stats = await storedStats(sourceId);
    const ok = types.filter((t) => outcomes[t]?.status === 'ok').length;
    const status: SyncXtreamResult['status'] =
      ok === types.length ? 'ok' : ok > 0 ? 'partial' : 'error';
    const merged: Partial<Record<ContentType, TypeSyncStatus>> = { ...current.lastSyncByType };
    for (const t of types) {
      const outcome = outcomes[t];
      if (!outcome) continue;
      const previous = merged[t]?.lastOkAt;
      merged[t] =
        outcome.status === 'ok' || previous === undefined
          ? outcome
          : { ...outcome, lastOkAt: previous };
    }
    const changes: Partial<Omit<Source, 'id'>> = { stats, lastSyncByType: merged };
    if (mode === 'complete') {
      changes.lastSyncStatus = status;
      changes.lastSyncError = types.map((t) => outcomes[t]?.error).find((e) => e !== undefined);
      if (ok > 0) changes.lastSyncAt = now();
    } else if (mode === 'fatal') {
      // Not advancing `lastSyncAt` makes `isSyncDue` retry on the next app open.
      changes.lastSyncStatus = 'error';
      changes.lastSyncError = fatalCode;
    }
    if (!(await sourcesRepo.update(sourceId, changes))) throw new SourceRemovedError();
    return { sourceId, status, types: outcomes, stats };
  }

  /** Records `code` for every requested type that has no outcome yet in this run. */
  function markRemaining(code: XtreamSyncErrorCode, httpStatus?: number): void {
    for (const t of types) {
      if (outcomes[t] !== undefined) continue;
      const outcome: TypeSyncStatus = { status: 'error', at: now(), error: code };
      if (httpStatus !== undefined) outcome.httpStatus = httpStatus;
      outcomes[t] = outcome;
    }
  }

  async function failAll(err: unknown): Promise<never> {
    const { code, httpStatus } = errorCode(err);
    markRemaining(code, httpStatus);
    await finish('fatal', code);
    log.warn('xtream sync: aborted', { sourceId, code });
    throw new WorkerTaskError('failed', `Xtream sync failed (${code})`);
  }

  let password: string | undefined;
  try {
    password = await vault.get(secretRef);
  } catch (err) {
    return failAll(err);
  }
  if (password === undefined) return failAll(new SyncTypeError('credentials-lost'));

  // Abort the in-flight request as soon as the client cancels (the context has no signal).
  const abort = new AbortController();
  const poll = setInterval(() => {
    if (ctx.cancelled) abort.abort();
  }, pollMs);
  const { signal } = abort;

  /** After an awaited step: a cancellation wins over whatever the step threw. */
  const checkpoint = () => ctx.throwIfCancelled();

  try {
    const base: XtreamClientOptions = { baseUrl: serverUrl, username, password };
    if (deps.fetchImpl) base.fetchImpl = deps.fetchImpl;
    let categoriesClient: ReturnType<typeof createXtreamClient>;
    let itemsClient: ReturnType<typeof createXtreamClient>;
    try {
      categoriesClient = createXtreamClient({
        ...base,
        timeoutMs: deps.categoriesTimeoutMs ?? CATEGORIES_TIMEOUT_MS,
      });
      itemsClient = createXtreamClient({
        ...base,
        timeoutMs: deps.itemsTimeoutMs ?? ITEMS_TIMEOUT_MS,
      });
      const info = await categoriesClient.authenticate(signal);
      checkpoint();
      const status = info.account.status?.toLowerCase();
      if (status !== undefined && status !== 'active') {
        throw new SyncTypeError('account-inactive');
      }
    } catch (err) {
      checkpoint();
      return await failAll(err);
    }
    ctx.progress({ phase: 'auth', done: 1, total: 1 });

    const mapOptions: MapOptions = { isStorableUrl: credentialFreeUrl(username, password) };

    for (const type of types) {
      checkpoint();
      const actions = XTREAM_CATALOG_ACTIONS[type];
      try {
        ctx.progress({ phase: `${type}-categories`, done: 0 });
        const rawCategories = asList(await categoriesClient.call(actions.categories, {}, signal));
        checkpoint();
        const categories = mapCategories(rawCategories);
        ctx.progress({
          phase: `${type}-categories`,
          done: categories.items.length,
          total: categories.items.length,
        });

        ctx.progress({ phase: type, done: 0 });
        const mapped = mapItems(
          type,
          asList(await itemsClient.call(actions.items, {}, signal)),
          mapOptions,
        );
        checkpoint();
        const received = mapped.items.length + mapped.skipped;
        if (received > 0 && mapped.items.length === 0) throw new SyncTypeError('invalid-response');
        if (
          received === 0 &&
          rawCategories.length > 0 &&
          (await catalogRepo.count(sourceId, type)) > 0
        ) {
          throw new SyncTypeError('empty-response');
        }
        ctx.progress({ phase: type, done: 0, total: mapped.items.length });

        checkpoint();
        let written: Awaited<ReturnType<typeof catalogRepo.replaceForExistingSource>>;
        try {
          written = await catalogRepo.replaceForExistingSource(sourceId, type, {
            categories: categories.items,
            items: mapped.items,
          });
        } catch {
          // The transaction rolled back: this type keeps its previous data.
          throw new SyncTypeError('storage');
        }
        if (written === undefined) throw new SourceRemovedError();
        const at = now();
        outcomes[type] = {
          status: 'ok',
          at,
          lastOkAt: at,
          items: written.items,
          categories: written.categories,
          skipped: mapped.skipped + categories.skipped,
        };
        ctx.progress({ phase: type, done: written.items, total: written.items });
        if (mapped.skipped + categories.skipped > 0) {
          log.info('xtream sync: invalid entries skipped', {
            type,
            items: mapped.skipped,
            categories: categories.skipped,
          });
        }
      } catch (err) {
        if (err instanceof SourceRemovedError) throw err;
        checkpoint();
        const { code, httpStatus } = errorCode(err);
        if (FATAL_CODES.has(code)) return await failAll(err);
        const outcome: TypeSyncStatus = { status: 'error', at: now(), error: code };
        if (httpStatus !== undefined) outcome.httpStatus = httpStatus;
        outcomes[type] = outcome;
        log.warn('xtream sync: type failed', { type, code, httpStatus });
        if (UNREACHABLE_CODES.has(code)) {
          markRemaining('server-unreachable');
          break;
        }
      }
    }

    checkpoint();
    const result = await finish('complete');
    ctx.progress({ phase: 'done', done: types.length, total: types.length });
    log.info('xtream sync: finished', {
      sourceId,
      status: result.status,
      ms: now() - startedAt,
      stats: result.stats,
    });
    return result;
  } catch (err) {
    if (ctx.cancelled && !(err instanceof SourceRemovedError)) {
      // Keep the record of what was written before the cancellation; leave the overall status.
      await finish('cancelled').catch(() => undefined);
      ctx.throwIfCancelled();
    }
    throw err;
  } finally {
    clearInterval(poll);
  }
}
