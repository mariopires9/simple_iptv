// Xtream catalogue sync (SRC-07, ARCHITECTURE.md §6.1, ADR-009). Runs inside the data worker.
//
// Flow: source → vault (password) → auth → for each type: categories, items (JSON.parse happens
// here, in the worker) → tolerant validation → `catalogRepo.replaceForSource` (one transaction per
// type) → source status/stats.
//
// Credentials: the password is read from the vault *inside the worker* (IndexedDB and WebCrypto
// are available in dedicated workers), so it never crosses postMessage. The task input/output and
// every progress message carry only ids, counts and phase names.
//
// Failures:
// - Anything that prevents authenticating (auth rejected, inactive account, network, timeout…)
//   or a 401/403 in a later call aborts the whole sync: every requested type is marked with the
//   error code and the task fails with `WorkerTaskError('failed', 'Xtream sync failed (<code>)')`.
// - Any other failure is per type: that type keeps its previous data (its transaction never ran),
//   the others are written, and the result/source record the error per type (status `partial`).
// - Cancellation is checked between phases and before each write; an in-flight request is
//   aborted. Types already written stay written (each is complete and consistent); the others keep
//   their previous data.
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
import { createXtreamClient, type XtreamClient } from './client';

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
 * - `storage`: writing to IndexedDB failed (e.g. quota)
 * - `credentials-lost`: the vault cannot decrypt the password (user must re-enter it)
 * - `unknown`
 */
export type XtreamSyncErrorCode =
  | NetError['kind']
  | 'account-inactive'
  | 'invalid-response'
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
  /** Per-request timeout; catalogue lists can be tens of MB. Default 120 s. */
  timeoutMs?: number;
  /** How often an in-flight request checks for cancellation (ms). Default 50. */
  cancelPollMs?: number;
}

export const SYNC_REQUEST_TIMEOUT_MS = 120_000;

/** Codes that make the rest of the sync pointless: stop everything. */
const FATAL_CODES: ReadonlySet<XtreamSyncErrorCode> = new Set(['auth', 'account-inactive']);

class SyncTypeError extends Error {
  override readonly name = 'SyncTypeError';
  constructor(readonly code: XtreamSyncErrorCode) {
    super(`Xtream sync step failed (${code})`);
  }
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

/** Rejects stored image URLs that embed the account credentials (ARCHITECTURE.md §5). */
export function credentialFreeUrl(username: string, password: string): (href: string) => boolean {
  return (href) => {
    let text = href;
    try {
      text = decodeURIComponent(href);
    } catch {
      // Keep the raw form.
    }
    if (/[?&](username|password|token)=/i.test(text)) return false;
    if (password.length >= 4 && text.includes(password)) return false;
    if (text.includes(`/${username}/${password}/`)) return false;
    return true;
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

/**
 * Syncs the catalogue of an Xtream source into IndexedDB. Must run in the data worker
 * (registered as task `syncXtream` in src/worker/tasks.ts); also callable directly in tests.
 */
export async function syncXtreamSource(
  input: SyncXtreamInput,
  ctx: TaskContext,
  deps: SyncXtreamDeps = {},
): Promise<SyncXtreamResult> {
  const vault = deps.vault ?? credentialVault;
  const now = deps.now ?? Date.now;
  const types = requestedTypes(input.types);
  const { sourceId } = input;

  ctx.throwIfCancelled();
  if (types.length === 0) throw new WorkerTaskError('failed', 'Xtream sync: no content types');
  ctx.progress({ phase: 'auth', done: 0 });

  const found = typeof sourceId === 'string' ? await sourcesRepo.get(sourceId) : undefined;
  if (!found) throw new WorkerTaskError('failed', 'Xtream sync: source not found');
  const source: Source = found;
  if (source.kind !== 'xtream') {
    throw new WorkerTaskError('failed', 'Xtream sync: not an Xtream source');
  }
  if (!source.serverUrl || !source.username || !source.secretRef) {
    throw new WorkerTaskError('failed', 'Xtream sync: source has no credentials');
  }
  const username = source.username;

  const outcomes: Partial<Record<ContentType, TypeSyncStatus>> = {};
  const startedAt = now();

  /** Persists per-type outcomes, real stored counts and (unless cancelled) the overall status. */
  async function finish(cancelled: boolean): Promise<SyncXtreamResult> {
    const stats = await storedStats(source.id);
    const ok = types.filter((t) => outcomes[t]?.status === 'ok').length;
    const status: SyncXtreamResult['status'] =
      ok === types.length ? 'ok' : ok > 0 ? 'partial' : 'error';
    const merged: Partial<Record<ContentType, TypeSyncStatus>> = {
      ...source.lastSyncByType,
    };
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
    if (!cancelled) {
      const firstError = types.map((t) => outcomes[t]?.error).find((e) => e !== undefined);
      changes.lastSyncStatus = status;
      changes.lastSyncError = firstError;
      if (ok > 0) changes.lastSyncAt = now();
    }
    await sourcesRepo.update(source.id, changes);
    return { sourceId: source.id, status, types: outcomes, stats };
  }

  async function failAll(err: unknown): Promise<never> {
    const { code, httpStatus } = errorCode(err);
    for (const t of types) {
      if (outcomes[t]?.status === 'ok') continue;
      const outcome: TypeSyncStatus = { status: 'error', at: now(), error: code };
      if (httpStatus !== undefined) outcome.httpStatus = httpStatus;
      outcomes[t] = outcome;
    }
    await finish(false);
    log.warn('xtream sync: aborted', { sourceId: source.id, code });
    throw new WorkerTaskError('failed', `Xtream sync failed (${code})`);
  }

  let password: string | undefined;
  try {
    password = await vault.get(source.secretRef);
  } catch (err) {
    return failAll(err);
  }
  if (password === undefined) return failAll(new SyncTypeError('credentials-lost'));

  // Abort the in-flight request as soon as the client cancels (the context has no signal).
  const abort = new AbortController();
  const poll = setInterval(() => {
    if (ctx.cancelled) abort.abort();
  }, deps.cancelPollMs ?? 50);
  const { signal } = abort;

  /** After an awaited step: a cancellation wins over whatever the step threw. */
  const checkpoint = () => ctx.throwIfCancelled();

  try {
    const clientOptions: Parameters<typeof createXtreamClient>[0] = {
      baseUrl: source.serverUrl,
      username,
      password,
      timeoutMs: deps.timeoutMs ?? SYNC_REQUEST_TIMEOUT_MS,
    };
    if (deps.fetchImpl) clientOptions.fetchImpl = deps.fetchImpl;
    let client: XtreamClient;
    try {
      client = createXtreamClient(clientOptions);
      const info = await client.authenticate(signal);
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
        const categories = mapCategories(asList(await client.call(actions.categories, {}, signal)));
        checkpoint();
        ctx.progress({
          phase: `${type}-categories`,
          done: categories.items.length,
          total: categories.items.length,
        });

        ctx.progress({ phase: type, done: 0 });
        const mapped = mapItems(
          type,
          asList(await client.call(actions.items, {}, signal)),
          mapOptions,
        );
        checkpoint();
        const received = mapped.items.length + mapped.skipped;
        if (received > 0 && mapped.items.length === 0) throw new SyncTypeError('invalid-response');
        ctx.progress({ phase: type, done: 0, total: mapped.items.length });

        checkpoint();
        let written: Awaited<ReturnType<typeof catalogRepo.replaceForSource>>;
        try {
          written = await catalogRepo.replaceForSource(sourceId, type, {
            categories: categories.items,
            items: mapped.items,
          });
        } catch {
          // The transaction rolled back: this type keeps its previous data.
          throw new SyncTypeError('storage');
        }
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
        checkpoint();
        const { code, httpStatus } = errorCode(err);
        if (FATAL_CODES.has(code)) return await failAll(err);
        const outcome: TypeSyncStatus = { status: 'error', at: now(), error: code };
        if (httpStatus !== undefined) outcome.httpStatus = httpStatus;
        outcomes[type] = outcome;
        log.warn('xtream sync: type failed', { type, code, httpStatus });
      }
    }

    checkpoint();
    const result = await finish(false);
    ctx.progress({ phase: 'done', done: types.length, total: types.length });
    log.info('xtream sync: finished', {
      sourceId,
      status: result.status,
      ms: now() - startedAt,
      stats: result.stats,
    });
    return result;
  } catch (err) {
    if (ctx.cancelled) {
      // Keep the record of what was written before the cancellation; leave the overall status.
      await finish(true).catch(() => undefined);
      ctx.throwIfCancelled();
    }
    throw err;
  } finally {
    clearInterval(poll);
  }
}
