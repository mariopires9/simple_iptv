// M3U-by-URL import / refresh (SRC-04 + SRC-05). Runs inside the data worker as task `syncM3u`.
//
// Flow: source row → vault (list URL) → streaming download + parse (bytes and entries reported as
// they arrive) → catalogue rows → one guarded transaction for all three types → source status.
//
// Credentials: the list URL often embeds them (`get.php?username=…&password=…`, tokens). It is
// read from the vault *inside the worker* and never crosses postMessage: the task input is
// `{ sourceId }`, progress carries only phase names and counts, the result only counts and codes.
// Logs carry codes, counts and the shortened URL (`NetError.target`). The list URL's credentials
// (`listUrlSecrets`) are registered with the log redactor. Stored rows: only `streamUrl` holds the
// full stream URL (ARCHITECTURE.md §5 decision); logos, catch-up templates and header EPG URLs that
// contain the list's credentials are dropped (`isStorableUrl`).
//
// Outcomes:
// - Success: every type (live/movie/series) is replaced with this list's content — the list is the
//   whole truth, so a type absent from it becomes empty — and the source records stats,
//   `lastSyncAt`, `lastSyncByType` and the header `epgUrls`.
// - Expected failure (network, HTTP status, not an M3U list, no valid entry, too large, storage,
//   lost vault key): resolves with `status: 'error'` and a stable `error` code (+ `hint` for a
//   blocked request); the previous catalogue stays untouched (the write is a single transaction
//   for live+movie+series) and the source records the code without advancing `lastSyncAt`.
// - Internal error (an exception that is not a network failure, e.g. a parser bug): recorded on
//   the source as `internal`, logged, and the task rejects with `WorkerTaskError('failed')`.
// - Cancellation (any time before the write phase starts): rejects with
//   `WorkerTaskError('cancelled')`; nothing is written and the source row is untouched. Once the
//   write phase starts it completes (the UI then reports the real outcome).
// - Source removed meanwhile: the existence check runs inside the write transaction; nothing is
//   written and the task rejects with `WorkerTaskError('cancelled', '… (source-removed)')`.
// - Accepted bodies: first meaningful line `#EXTM3U` or `#EXTINF`, or valid entries found within
//   SNIFF_BYTES; anything else (HTML, JSON, empty) is `not-m3u`.
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
 * Then `write` (`done`/`total` = rows: items plus the episodes of grouped shows) and `done`.
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
 * - `not-m3u`: the response is not a playlist (HTML, JSON, empty…)
 * - `empty-list`: an M3U list without any valid entry
 * - `too-large`: more than {@link MAX_ENTRIES} entries or {@link MAX_BYTES} bytes
 * - `invalid-url`: the stored list URL is not an acceptable http(s) URL
 * - `credentials-lost`: the vault cannot decrypt the list URL
 * - `storage`: writing to IndexedDB failed (e.g. quota); nothing was changed
 * - `internal`: a non-network exception (bug); the task also rejects with `failed`
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
  | 'internal'
  | 'unknown';

export interface SyncM3uResult {
  sourceId: string;
  status: 'ok' | 'error';
  error?: M3uSyncErrorCode;
  /** With `error: 'http' | 'auth'`. */
  httpStatus?: number;
  /** With `error: 'blocked'`: the likely cause. */
  hint?: NetErrorHint;
  /** Real stored counts after the import (`series` = shows, VOD-04). */
  stats: SourceStats;
  /** Episodes stored in grouped shows (VOD-04): `stats` + `episodes` cover every entry kept. */
  episodes?: number;
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
  /**
   * Called after a successful import, once the source is released and `done` was reported
   * (SCH-01: the data worker queues the search index rebuild). Not awaited; a throw is logged.
   */
  afterSync?: (sourceId: string) => void;
}

/** Guards against lists that would exhaust memory on weak devices. */
export const MAX_ENTRIES = 500_000;
export const MAX_BYTES = 512 * 1024 * 1024;
/** A body without `#EXTM3U`/`#EXTINF` first must show a valid entry within this many bytes. */
export const SNIFF_BYTES = 64 * 1024;

class SourceRemovedError extends Error {
  override readonly name = 'SourceRemovedError';
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// Credentials in the list URL
// ---------------------------------------------------------------------------------------------

/** Query parameters whose values are credentials (≥ 3 characters). */
const SECRET_PARAM = /user|pass|pwd|token|key|auth|sig|secret|session|sid/i;
/** Path segments followed by `/<user>/<pass>/…` in Xtream-style URLs. */
const CREDENTIAL_PATH_PREFIXES: ReadonlySet<string> = new Set([
  'playlist',
  'get',
  'live',
  'movie',
  'series',
  'timeshift',
]);
const MIN_SECRET = 3;

/**
 * Values of the list URL that must not end up in stored image/EPG/catch-up URLs or in logs:
 * - values (≥ 3 chars) of query parameters named like username/password/token/key/…, and any
 *   other query value of 12+ characters;
 * - in Xtream-style paths (`/playlist/<user>/<pass>/…`, `/live/<user>/<pass>/…`, …) the two
 *   segments after the known prefix;
 * - long opaque path segments (16+ characters), which are usually access tokens.
 */
export function listUrlSecrets(listUrl: URL): string[] {
  const secrets = new Set<string>();
  for (const [name, value] of listUrl.searchParams) {
    if (value.length >= MIN_SECRET && (SECRET_PARAM.test(name) || value.length >= 12)) {
      secrets.add(value);
    }
  }
  const segments = listUrl.pathname
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  segments.forEach((segment, i) => {
    if (CREDENTIAL_PATH_PREFIXES.has(segment.toLowerCase()) && i + 2 < segments.length) {
      for (const credential of segments.slice(i + 1, i + 3)) {
        if (credential.length >= MIN_SECRET) secrets.add(credential);
      }
    }
    if (segment.length >= 16 && /^[A-Za-z0-9_\-~%]+$/.test(segment)) secrets.add(segment);
  });
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
  let result: SyncM3uResult;
  try {
    result = await runSync(sourceId, ctx, deps, pollMs);
  } catch (err) {
    if (err instanceof SourceRemovedError) {
      log.info('m3u sync: source removed during sync', { sourceId });
      throw new WorkerTaskError('cancelled', 'M3U sync stopped (source-removed)');
    }
    throw err;
  } finally {
    release();
  }
  if (result.status === 'ok') notifyAfterSync(deps, sourceId);
  return result;
}

/** Runs the `afterSync` hook (never awaited, never fails the sync: errors are only logged). */
function notifyAfterSync(deps: SyncM3uDeps, sourceId: string): void {
  try {
    deps.afterSync?.(sourceId);
  } catch (error) {
    log.warn('m3u sync: after-sync hook failed', { sourceId, error });
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
  const downloadMessage = (): M3uSyncProgress =>
    total !== undefined
      ? { phase: 'download', done: bytes, total }
      : { phase: 'download', done: bytes };
  /** Alternates `download` (bytes) and `parse` (entries) messages; real time, not `deps.now`. */
  const report = () => {
    const t = Date.now();
    if (t - lastReport < PROGRESS_INTERVAL_MS) return;
    lastReport = t;
    progress(parseNext ? { phase: 'parse', done: parser.stats.entries } : downloadMessage());
    parseNext = !parseNext;
  };
  /** Waits until the next message cannot replace the previous one in the worker's throttle. */
  const spaced = async () => {
    const wait = lastReport + PROGRESS_INTERVAL_MS - Date.now();
    if (wait > 0) await pause(wait);
    lastReport = Date.now();
  };
  /** Accepted as a playlist: `#EXTM3U` / `#EXTINF` first, or valid entries found anyway. */
  const looksLikeM3u = () =>
    parser.firstLine === 'header' || parser.firstLine === 'extinf' || parser.stats.entries > 0;
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
        if (!looksLikeM3u() && bytes >= SNIFF_BYTES) stop = 'not-m3u';
        else if (parser.stats.entries > MAX_ENTRIES || bytes > MAX_BYTES) stop = 'too-large';
        return stop === undefined;
      },
    });
    bytes = download.bytes;
    ctx.throwIfCancelled();
    if (stop === undefined && !looksLikeM3u()) stop = 'not-m3u';
  } catch (err) {
    ctx.throwIfCancelled();
    if (err instanceof NetError) {
      const kind = err.kind;
      if (kind !== 'aborted') {
        const extra: { httpStatus?: number; hint?: NetErrorHint } = {};
        if (err.status !== undefined) extra.httpStatus = err.status;
        if (err.hint !== undefined) extra.hint = err.hint;
        return await fail(kind, extra);
      }
    }
    // Not a network failure (parser / progress / logic bug): record it and fail the task.
    log.error('m3u sync: internal error', { sourceId, error: err });
    await fail('internal');
    throw new WorkerTaskError('failed', 'M3U sync failed (internal)');
  } finally {
    clearInterval(poll);
  }
  if (stop !== undefined) return fail(stop);
  if (parser.stats.entries === 0) return fail('empty-list');

  // Final totals: spaced so the worker's latest-wins throttle delivers both, and the first
  // `write` message does not replace them.
  await spaced();
  progress(downloadMessage());
  await spaced();
  progress({ phase: 'parse', done: parser.stats.entries });
  await spaced();

  // --- Write: the three types in one transaction (all or nothing); not cancellable ---
  ctx.throwIfCancelled();
  const catalog = builder.build();
  const episodeCount = catalog.seriesDetails.reduce(
    (n, d) => n + d.seasons.reduce((m, s) => m + s.episodes.length, 0),
    0,
  );
  const totalItems = CONTENT_TYPES.reduce((n, t) => n + catalog[t].items.length, 0) + episodeCount;
  progress({ phase: 'write', done: 0, total: totalItems });
  let written: Awaited<ReturnType<typeof catalogRepo.replaceAllForExistingSource>>;
  try {
    written = await catalogRepo.replaceAllForExistingSource(sourceId, catalog);
  } catch (err) {
    // The transaction rolled back: the previous catalogue is intact.
    log.warn('m3u sync: storage failure', { sourceId, error: err });
    return fail('storage');
  }
  if (written === undefined) throw new SourceRemovedError();
  progress({ phase: 'write', done: totalItems, total: totalItems });
  const at = now();
  const outcomes: Partial<Record<ContentType, TypeSyncStatus>> = {};
  for (const type of CONTENT_TYPES) {
    outcomes[type] = {
      status: 'ok',
      at,
      lastOkAt: at,
      items: written[type].items,
      categories: written[type].categories,
    };
  }
  const episodes = written.series.episodes ?? 0;
  if (outcomes.series) outcomes.series.episodes = episodes;

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
    episodes,
    regrouped: written.series.regrouped,
    ms: now() - startedAt,
  });
  return result('ok', stats, { epgUrls: epgUrls.length, episodes });
}
