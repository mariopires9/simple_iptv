// M3U-by-URL import / refresh (SRC-04 + SRC-05). Runs inside the data worker as task `syncM3u`.
//
// Flow: source row → vault (list URL) → streaming download + parse (bytes and entries reported as
// they arrive) → catalogue rows per type → guarded replace per type → source stats/status.
//
// Credentials: the list URL often embeds them (`get.php?username=…&password=…`, tokens). It is
// read from the vault *inside the worker* and never crosses postMessage: the task input is
// `{ sourceId }`, progress carries only phase names and counts, the result only counts and codes.
// Logs carry codes, counts and the shortened URL (`NetError.target`). Its query values are also
// registered with the log redactor. Stored rows: only `streamUrl`/`streamPath` hold the full stream
// URLs (ARCHITECTURE.md §5 decision); logos, catch-up templates and header EPG URLs that contain
// the list's credentials are dropped (`isStorableUrl`).
//
// Outcomes:
// - Success: every type (live/movie/series) is replaced with this list's content — the list is the
//   whole truth, so a type absent from it becomes empty — and the source records stats,
//   `lastSyncAt`, `lastSyncByType` and the header `epgUrls`.
// - Expected failure (network, HTTP status, not an M3U list, no valid entry, too large, storage,
//   lost vault key): resolves with `status: 'error'` and a stable `error` code (+ `hint` for a
//   blocked request); the previous catalogue stays untouched and the source records the code
//   without advancing `lastSyncAt`.
// - Cancellation (any time before the write phase starts): rejects with
//   `WorkerTaskError('cancelled')`; nothing is written and the source row is untouched. Once the
//   write phase starts it completes, so the three types stay consistent with each other.
// - Source removed meanwhile: the existence check runs inside each write transaction; nothing is
//   written and the task rejects with `WorkerTaskError('cancelled', '… (source-removed)')`.
// - Concurrency: imports of the same source are serialised (per-source queue in this worker).
import {
  CONTENT_TYPES,
  catalogRepo,
  sourcesRepo,
  type ContentType,
  type Source,
  type SourceStats,
  type TypeSyncStatus,
} from '@/core/db';
import { credentialVault, VaultKeyLostError, type CredentialVault } from '@/core/crypto';
import { log, registerSecret } from '@/core/log';
import {
  NetError,
  parseExternalUrl,
  type FetchImpl,
  type NetErrorHint,
  type NetErrorKind,
} from '@/core/net';
import { WorkerTaskError, type TaskContext, type TaskProgress } from '@/core/worker';
import { M3uCatalogBuilder } from './catalog';
import { downloadM3u, DOWNLOAD_INACTIVITY_TIMEOUT_MS } from './download';
import { M3uParser, type M3uSkipReason } from './parser';

/**
 * Progress phases. Download and parsing are streamed together, so while the list downloads two
 * kinds of message alternate (at most one every {@link PROGRESS_INTERVAL_MS}, so the worker's
 * latest-wins progress throttle does not drop either kind):
 * - `download`: `done` = bytes read, `total` = Content-Length when known;
 * - `parse`: `done` = valid entries parsed so far.
 * Then `write` (`done`/`total` = items) and `done`.
 */
export type M3uSyncPhase = 'download' | 'parse' | 'write' | 'done';

export interface M3uSyncProgress extends TaskProgress {
  phase: M3uSyncPhase;
}

/** Minimum interval between download/parse progress messages (ms). */
export const PROGRESS_INTERVAL_MS = 60;

export interface SyncM3uInput {
  sourceId: string;
}

/**
 * Error codes (never sensitive): `NetErrorKind`s (`offline`, `timeout`, `blocked`, `http`, `auth`,
 * `parse`) plus:
 * - `not-m3u`: the response does not start with `#EXTM3U` (e.g. an HTML page) or is empty
 * - `empty-list`: an M3U list without any valid entry
 * - `too-large`: more than {@link MAX_ENTRIES} entries or {@link MAX_BYTES} bytes
 * - `invalid-url`: the stored list URL is not an acceptable http(s) URL
 * - `credentials-lost`: the vault cannot decrypt the list URL
 * - `storage`: writing to IndexedDB failed (e.g. quota)
 * - `unknown`
 */
export type M3uSyncErrorCode =
  | Exclude<NetErrorKind, 'aborted'>
  | 'not-m3u'
  | 'empty-list'
  | 'too-large'
  | 'invalid-url'
  | 'credentials-lost'
  | 'storage'
  | 'unknown';

export interface SyncM3uResult {
  sourceId: string;
  status: 'ok' | 'error';
  error?: M3uSyncErrorCode;
  /** With `error: 'http' | 'auth'`. */
  httpStatus?: number;
  /** With `error: 'blocked'`: the likely cause. */
  hint?: NetErrorHint;
  /** Real stored counts after the import. */
  stats: SourceStats;
  /** Valid entries in the list (before deduplication). */
  entries: number;
  /** Entries skipped, total and by reason. */
  skipped: number;
  skippedByReason: Record<M3uSkipReason, number>;
  bytes: number;
  /** EPG URLs from the header that were stored on the source. */
  epgUrls: number;
}

export interface SyncM3uDeps {
  vault?: CredentialVault;
  fetchImpl?: FetchImpl;
  now?: () => number;
  inactivityTimeoutMs?: number;
  /** How often cancellation is polled while waiting (ms). Default 50. */
  cancelPollMs?: number;
}

/** Guards against lists that would exhaust memory on weak devices. */
export const MAX_ENTRIES = 500_000;
export const MAX_BYTES = 512 * 1024 * 1024;

class SourceRemovedError extends Error {
  override readonly name = 'SourceRemovedError';
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// Credentials in the list URL
// ---------------------------------------------------------------------------------------------

const SECRET_PARAM = /user|pass|pwd|token|key|auth|sig|secret|session|sid/i;

/** Values of the list URL that must not end up in stored image/EPG URLs or in logs. */
export function listUrlSecrets(listUrl: URL): string[] {
  const secrets = new Set<string>();
  for (const [name, value] of listUrl.searchParams) {
    if (value.length >= 3 && (SECRET_PARAM.test(name) || value.length >= 12)) secrets.add(value);
  }
  for (const segment of listUrl.pathname.split('/')) {
    // Long opaque path segments are usually access tokens.
    if (segment.length >= 16 && /^[A-Za-z0-9_\-.~%]+$/.test(segment) && !segment.includes('.')) {
      secrets.add(segment);
    }
  }
  return [...secrets];
}

/** `false` for URLs that carry credential parameters or any of the list's secrets. */
export function storableUrlCheck(secrets: readonly string[]): (href: string) => boolean {
  return (href) => {
    let text = href;
    try {
      text = decodeURIComponent(href);
    } catch {
      // Keep the raw form.
    }
    if (/[?&](username|password|token)=/i.test(text)) return false;
    return !secrets.some((s) => text.includes(s) || href.includes(s));
  };
}

// ---------------------------------------------------------------------------------------------
// Per-source queue (same pattern as providers/xtream/sync.ts)
// ---------------------------------------------------------------------------------------------

const queues = new Map<string, Promise<void>>();

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

/** Whether an M3U import of `sourceId` is running or queued in this worker. */
export function isM3uSourceSyncing(sourceId: string): boolean {
  return queues.has(sourceId);
}

/** Resolves when no M3U import of `sourceId` is running or queued in this worker. */
export async function waitForM3uSourceIdle(sourceId: string): Promise<void> {
  for (let tail = queues.get(sourceId); tail; tail = queues.get(sourceId)) await tail;
}

// ---------------------------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------------------------

async function storedStats(sourceId: string): Promise<SourceStats> {
  const [live, movies, series] = await Promise.all([
    catalogRepo.count(sourceId, 'live'),
    catalogRepo.count(sourceId, 'movie'),
    catalogRepo.count(sourceId, 'series'),
  ]);
  return { live, movies, series };
}

/**
 * Downloads, parses and stores an M3U-URL source. Must run in the data worker (task `syncM3u` in
 * src/worker/tasks.ts); also callable directly in tests.
 */
export async function syncM3uSource(
  input: SyncM3uInput,
  ctx: TaskContext,
  deps: SyncM3uDeps = {},
): Promise<SyncM3uResult> {
  const sourceId = input?.sourceId;
  const pollMs = deps.cancelPollMs ?? 50;
  ctx.throwIfCancelled();
  if (typeof sourceId !== 'string' || sourceId === '') {
    throw new WorkerTaskError('failed', 'M3U sync: source not found');
  }
  const release = await acquireSource(sourceId, ctx, pollMs);
  try {
    return await runSync(sourceId, ctx, deps, pollMs);
  } catch (err) {
    if (err instanceof SourceRemovedError) {
      log.info('m3u sync: source removed during sync', { sourceId });
      throw new WorkerTaskError('cancelled', 'M3U sync stopped (source-removed)');
    }
    throw err;
  } finally {
    release();
  }
}

async function runSync(
  sourceId: string,
  ctx: TaskContext,
  deps: SyncM3uDeps,
  pollMs: number,
): Promise<SyncM3uResult> {
  const vault = deps.vault ?? credentialVault;
  const now = deps.now ?? Date.now;
  const startedAt = now();

  const progress = (p: M3uSyncProgress) => ctx.progress(p);
  progress({ phase: 'download', done: 0 });

  const source = await sourcesRepo.get(sourceId);
  if (!source) throw new WorkerTaskError('failed', 'M3U sync: source not found');
  if (source.kind !== 'm3u-url')
    throw new WorkerTaskError('failed', 'M3U sync: not an M3U URL source');
  if (!source.secretRef) throw new WorkerTaskError('failed', 'M3U sync: source has no list URL');

  let builder = new M3uCatalogBuilder();
  const parser = new M3uParser({ onEntry: (entry) => builder.add(entry) });
  let bytes = 0;

  const result = (
    status: SyncM3uResult['status'],
    stats: SourceStats,
    extra: Partial<SyncM3uResult> = {},
  ): SyncM3uResult => ({
    sourceId,
    status,
    stats,
    entries: parser.stats.entries,
    skipped: parser.stats.skipped,
    skippedByReason: { ...parser.stats.skippedByReason },
    bytes,
    epgUrls: 0,
    ...extra,
  });

  /** Records a failure on the source (previous catalogue kept) and resolves with it. */
  async function fail(
    code: M3uSyncErrorCode,
    extra: { httpStatus?: number; hint?: NetErrorHint } = {},
  ): Promise<SyncM3uResult> {
    const current = await sourcesRepo.get(sourceId);
    if (!current) throw new SourceRemovedError();
    const at = now();
    const byType: Partial<Record<ContentType, TypeSyncStatus>> = { ...current.lastSyncByType };
    for (const type of CONTENT_TYPES) {
      const outcome: TypeSyncStatus = { status: 'error', at, error: code };
      if (extra.httpStatus !== undefined) outcome.httpStatus = extra.httpStatus;
      const lastOkAt = byType[type]?.lastOkAt;
      if (lastOkAt !== undefined) outcome.lastOkAt = lastOkAt;
      byType[type] = outcome;
    }
    const updated = await sourcesRepo.update(sourceId, {
      lastSyncStatus: 'error',
      lastSyncError: code,
      lastSyncByType: byType,
    });
    if (!updated) throw new SourceRemovedError();
    log.warn('m3u sync: failed', { sourceId, code, ...extra, ms: now() - startedAt });
    return result('error', await storedStats(sourceId), { error: code, ...extra });
  }

  // --- List URL from the vault (never leaves the worker) ---
  let listUrl: URL;
  try {
    const raw = await vault.get(source.secretRef);
    if (raw === undefined) return await fail('credentials-lost');
    const parsed = parseExternalUrl(raw, 'source');
    if (!parsed.ok) return await fail('invalid-url');
    listUrl = parsed.url;
  } catch (err) {
    if (err instanceof SourceRemovedError) throw err;
    return await fail(err instanceof VaultKeyLostError ? 'credentials-lost' : 'unknown');
  }
  const secrets = listUrlSecrets(listUrl);
  for (const secret of secrets) registerSecret(secret);
  const isStorableUrl = storableUrlCheck(secrets);
  builder = new M3uCatalogBuilder({ isStorableUrl });

  // --- Download + parse ---
  const abort = new AbortController();
  const poll = setInterval(() => {
    if (ctx.cancelled) abort.abort();
  }, pollMs);
  let stop: M3uSyncErrorCode | undefined;
  let total: number | undefined;
  let lastReport = -Infinity;
  let parseNext = false;
  /** Alternates `download` (bytes) and `parse` (entries) messages; real time, not `deps.now`. */
  const report = (force = false) => {
    const t = Date.now();
    if (!force && t - lastReport < PROGRESS_INTERVAL_MS) return;
    lastReport = t;
    if (parseNext) progress({ phase: 'parse', done: parser.stats.entries });
    else
      progress(
        total !== undefined
          ? { phase: 'download', done: bytes, total }
          : { phase: 'download', done: bytes },
      );
    parseNext = !parseNext;
  };
  try {
    ctx.throwIfCancelled();
    const download = await downloadM3u(listUrl.href, parser, {
      signal: abort.signal,
      inactivityTimeoutMs: deps.inactivityTimeoutMs ?? DOWNLOAD_INACTIVITY_TIMEOUT_MS,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      onBytes: (n, length) => {
        bytes = n;
        total = length;
      },
      onChunk: () => {
        report();
        if (ctx.cancelled) return false;
        if (parser.firstLine === 'other') stop = 'not-m3u';
        else if (parser.stats.entries > MAX_ENTRIES || bytes > MAX_BYTES) stop = 'too-large';
        return stop === undefined;
      },
    });
    bytes = download.bytes;
    ctx.throwIfCancelled();
    parseNext = false;
    report(true);
    report(true);
    if (stop === undefined && parser.firstLine !== 'header') stop = 'not-m3u';
  } catch (err) {
    ctx.throwIfCancelled();
    const kind = err instanceof NetError ? err.kind : undefined;
    if (err instanceof NetError && kind !== undefined && kind !== 'aborted') {
      const extra: { httpStatus?: number; hint?: NetErrorHint } = {};
      if (err.status !== undefined) extra.httpStatus = err.status;
      if (err.hint !== undefined) extra.hint = err.hint;
      return await fail(kind, extra);
    }
    return await fail('unknown');
  } finally {
    clearInterval(poll);
  }
  if (stop !== undefined) return fail(stop);
  if (parser.stats.entries === 0) return fail('empty-list');

  // --- Write (no cancellation from here on: the three types stay consistent) ---
  ctx.throwIfCancelled();
  const catalog = builder.build();
  const totalItems = CONTENT_TYPES.reduce((n, t) => n + catalog[t].items.length, 0);
  progress({ phase: 'write', done: 0, total: totalItems });
  const outcomes: Partial<Record<ContentType, TypeSyncStatus>> = {};
  let done = 0;
  for (const type of CONTENT_TYPES) {
    let written: Awaited<ReturnType<typeof catalogRepo.replaceForExistingSource>>;
    try {
      written = await catalogRepo.replaceForExistingSource(sourceId, type, catalog[type]);
    } catch {
      return fail('storage');
    }
    if (written === undefined) throw new SourceRemovedError();
    const at = now();
    outcomes[type] = {
      status: 'ok',
      at,
      lastOkAt: at,
      items: written.items,
      categories: written.categories,
    };
    done += catalog[type].items.length;
    progress({ phase: 'write', done, total: totalItems });
  }

  const epgUrls = parser.header.epgUrls.filter(isStorableUrl);
  const stats = await storedStats(sourceId);
  const changes: Partial<Omit<Source, 'id'>> = {
    stats,
    lastSyncAt: now(),
    lastSyncStatus: 'ok',
    lastSyncError: undefined,
    lastSyncByType: outcomes,
    epgUrls,
  };
  if (!(await sourcesRepo.update(sourceId, changes))) throw new SourceRemovedError();
  progress({ phase: 'done', done: totalItems, total: totalItems });
  log.info('m3u sync: finished', {
    sourceId,
    entries: parser.stats.entries,
    skipped: parser.stats.skipped,
    skippedByReason: parser.stats.skippedByReason,
    epgUrls: epgUrls.length,
    epgUrlsWithheld: parser.header.epgUrls.length - epgUrls.length,
    bytes,
    stats,
    ms: now() - startedAt,
  });
  return result('ok', stats, { epgUrls: epgUrls.length });
}
