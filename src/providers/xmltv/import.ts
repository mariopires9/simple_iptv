// XMLTV guide import for M3U lists — EPG-02 + EPG-03. Runs inside the data worker as task
// `importEpg`.
//
// Flow: source row → guide URLs (the manual one from the list settings first, then the list
// header's `url-tvg`/`x-tvg-url`, first that works) → purge of finished programmes (any source)
// → the list's live channels → streaming download + decompression + SAX parse; `<channel>`s feed
// the matcher, programmes inside the window (−2 h … +48 h) are mapped to the matched channels →
// the programmes are written in batches as they stream (the first batch replaces the source's
// guide) → `source.epgStatus`.
//
// Refresh: an import is due when the last success is older than 12 h (EPG_REFRESH_MS), or after a
// failure older than EPG_RETRY_MS; `force` (the user's "Refresh guide") skips that check. Each
// import replaces the source's whole guide, and every import first deletes programmes that ended
// before the window, so finished programmes do not accumulate (AC4).
//
// Failures record a stable code on `epgStatus` (never a URL). A feed that fails before its first
// batch is written (bad URL, HTTP error, not XMLTV, …) leaves the stored guide untouched; one that
// breaks off mid-stream leaves the part already written (a partial guide beats none).
// Concurrency: imports of the same source share the one in flight.
import {
  catalogRepo,
  epgRepo,
  sourcesRepo,
  type EpgImportStatus,
  type EpgProgram,
  type Source,
} from '@/core/db';
import { log } from '@/core/log';
import { NetError, parseExternalUrl, type FetchImpl, type UrlRewriter } from '@/core/net';
import { WorkerTaskError, type TaskContext } from '@/core/worker';
import { downloadXmltv, XmltvFormatError } from './download';
import { ChannelMatcher } from './match';
import { XmltvParseError, XmltvParser } from './parser';

export const EPG_WINDOW_PAST_MS = 2 * 60 * 60 * 1000;
export const EPG_WINDOW_FUTURE_MS = 48 * 60 * 60 * 1000;
export const EPG_REFRESH_MS = 12 * 60 * 60 * 1000;
export const EPG_RETRY_MS = 60 * 60 * 1000;
/** Guards against feeds that would exhaust memory on weak devices. */
export const MAX_PROGRAMMES = 400_000;
export const MAX_DECODED_CHARS = 1024 * 1024 * 1024;
/** A body that shows no `<tv>` within this many characters is not XMLTV. */
export const SNIFF_CHARS = 64 * 1024;
/** Programmes buffered before they are written (bounds the worker's memory, AC3). */
export const WRITE_BATCH = 5_000;

export interface ImportEpgInput {
  sourceId: string;
  /** Import even if the guide is fresh. */
  force?: boolean;
}

/**
 * `skipped`: nothing to do (fresh guide, no URL, not an M3U list, source gone). Error codes:
 * `NetErrorKind`s plus `not-xmltv`, `corrupt`, `too-large`, `storage`, `internal`.
 */
export interface ImportEpgResult {
  sourceId: string;
  status: 'ok' | 'error' | 'skipped';
  reason?: 'fresh' | 'no-url' | 'unsupported' | 'missing';
  error?: string;
  programmes?: number;
  channelsWithEpg?: number;
  channels?: number;
}

export interface ImportEpgDeps {
  fetchImpl?: FetchImpl;
  rewriterFor?: (source: Source) => Promise<UrlRewriter>;
  now?: () => number;
  inactivityTimeoutMs?: number;
}

/** Whether the guide of `source` should be (re)imported now. Pure. */
export function isEpgDue(source: Pick<Source, 'kind' | 'epgStatus'>, now: number): boolean {
  if (source.kind === 'xtream') return false;
  const status = source.epgStatus;
  if (!status) return true;
  const age = now - status.at;
  if (age < 0) return true; // clock moved back
  if (status.status === 'ok') return age >= EPG_REFRESH_MS;
  return age >= EPG_RETRY_MS;
}

/** Guide URLs of a list, manual first, deduplicated, only valid http(s) URLs. */
export function epgUrlsOf(source: Pick<Source, 'epgUrl' | 'epgUrls'>): string[] {
  const out: string[] = [];
  for (const raw of [source.epgUrl, ...(source.epgUrls ?? [])]) {
    if (raw === undefined) continue;
    const parsed = parseExternalUrl(raw, 'epg');
    if (parsed.ok && !out.includes(parsed.url.href)) out.push(parsed.url.href);
  }
  return out;
}

const running = new Map<string, Promise<ImportEpgResult>>();

export function importEpg(
  input: ImportEpgInput,
  ctx: TaskContext,
  deps: ImportEpgDeps = {},
): Promise<ImportEpgResult> {
  const sourceId = typeof input?.sourceId === 'string' ? input.sourceId : '';
  const inFlight = running.get(sourceId);
  if (inFlight) return inFlight;
  const task = runImport(sourceId, input.force === true, ctx, deps).finally(() => {
    if (running.get(sourceId) === task) running.delete(sourceId);
  });
  running.set(sourceId, task);
  return task;
}

interface Parsed {
  stored: number;
  channelsWithEpg: number;
  channels: number;
}

async function runImport(
  sourceId: string,
  force: boolean,
  ctx: TaskContext,
  deps: ImportEpgDeps,
): Promise<ImportEpgResult> {
  const now = deps.now ?? Date.now;
  const source = await sourcesRepo.get(sourceId);
  if (!source) return { sourceId, status: 'skipped', reason: 'missing' };
  if (source.kind === 'xtream') return { sourceId, status: 'skipped', reason: 'unsupported' };
  if (!force && !isEpgDue(source, now())) return { sourceId, status: 'skipped', reason: 'fresh' };
  const urls = epgUrlsOf(source);
  if (urls.length === 0) return { sourceId, status: 'skipped', reason: 'no-url' };

  const startedAt = now();
  await epgRepo.purgeEnded(startedAt - EPG_WINDOW_PAST_MS);
  const channels = await catalogRepo.listForSource(sourceId, 'live');
  const refs = channels.map((c) => ({
    key: c.key,
    name: c.name,
    ...(c.epgId !== undefined ? { epgId: c.epgId } : {}),
  }));
  const rewriter = deps.rewriterFor ? await deps.rewriterFor(source) : undefined;

  let error = 'unknown';
  for (const url of urls) {
    ctx.throwIfCancelled();
    try {
      const parsed = await parseFeed(url, sourceId, refs, startedAt, ctx, deps, rewriter);
      const at = now();
      const status: EpgImportStatus = {
        status: 'ok',
        at,
        lastOkAt: at,
        programmes: parsed.stored,
        channelsWithEpg: parsed.channelsWithEpg,
        channels: parsed.channels,
      };
      await sourcesRepo.update(sourceId, { epgStatus: status });
      ctx.progress({ phase: 'done', done: parsed.stored, total: parsed.stored });
      log.info('epg import: finished', {
        sourceId,
        programmes: parsed.stored,
        channelsWithEpg: parsed.channelsWithEpg,
        channels: parsed.channels,
        ms: at - startedAt,
      });
      return { sourceId, status: 'ok', ...pick(status) };
    } catch (failure) {
      if (failure instanceof WorkerTaskError) throw failure;
      if (failure instanceof SourceGoneError)
        return { sourceId, status: 'skipped', reason: 'missing' };
      if (failure instanceof StorageError) {
        log.warn('epg import: storage failed', { sourceId, error: failure.cause });
        error = 'storage';
        break;
      }
      if (failure instanceof NetError) {
        if (failure.kind === 'aborted') throw new WorkerTaskError('cancelled');
        error = failure.kind;
      } else if (failure instanceof XmltvFormatError) {
        error = failure.code;
      } else if (failure instanceof XmltvParseError) {
        error = 'not-xmltv';
      } else {
        log.error('epg import: internal error', { sourceId, error: failure });
        error = 'internal';
      }
      log.info('epg import: feed failed', { sourceId, error });
      // A feed that failed after its first batch was stored already replaced part of the guide:
      // the next feed (or the next attempt) replaces it again.
    }
  }
  const status: EpgImportStatus = { status: 'error', at: now(), error };
  if (source.epgStatus?.lastOkAt !== undefined) status.lastOkAt = source.epgStatus.lastOkAt;
  await sourcesRepo.update(sourceId, { epgStatus: status });
  return { sourceId, status: 'error', error };
}

class SourceGoneError extends Error {
  override readonly name = 'SourceGoneError';
}

class StorageError extends Error {
  override readonly name = 'StorageError';
}

const pick = (s: EpgImportStatus) => ({
  programmes: s.programmes ?? 0,
  channelsWithEpg: s.channelsWithEpg ?? 0,
  channels: s.channels ?? 0,
});

async function parseFeed(
  url: string,
  sourceId: string,
  refs: ConstructorParameters<typeof ChannelMatcher>[0],
  at: number,
  ctx: TaskContext,
  deps: ImportEpgDeps,
  rewriter: UrlRewriter | undefined,
): Promise<Parsed> {
  const from = at - EPG_WINDOW_PAST_MS;
  const to = at + EPG_WINDOW_FUTURE_MS;
  const matcher = new ChannelMatcher(refs);
  const withProgrammes = new Set<string>();
  let pending: EpgProgram[] = [];
  let stored = 0;
  let replaced = false;
  let tooMany = false;
  const parser = new XmltvParser({
    channel: (c) => matcher.addXmltvChannel(c.id, c.names),
    programme: (p) => {
      if (p.end <= from || p.start >= to) return;
      const keys = matcher.resolve(p.channel);
      if (keys.length === 0) return;
      withProgrammes.add(p.channel);
      for (const key of keys) {
        if (stored + pending.length >= MAX_PROGRAMMES) {
          tooMany = true;
          return;
        }
        const row: EpgProgram = {
          channelEpgId: key,
          start: p.start,
          end: p.end,
          sourceId,
          title: p.title,
        };
        if (p.desc !== undefined) row.desc = p.desc;
        pending.push(row);
      }
    },
  });
  // Rows are written in batches while the feed streams (memory stays bounded, AC3): the first
  // batch replaces the source's guide, later ones are added to it.
  const flush = async () => {
    if (replaced && pending.length === 0) return;
    const batch = pending;
    pending = [];
    let ok: boolean;
    try {
      ok = replaced
        ? await epgRepo.appendForExistingSource(sourceId, batch)
        : await epgRepo.replaceForExistingSource(sourceId, batch);
    } catch (failure) {
      throw new StorageError('storage', { cause: failure });
    }
    if (!ok) throw new SourceGoneError();
    replaced = true;
    stored += batch.length;
    ctx.progress({ phase: 'write', done: stored });
  };
  const controller = new AbortController();
  const poll = setInterval(() => {
    if (ctx.cancelled) controller.abort();
  }, 100);
  let chars = 0;
  try {
    await downloadXmltv(url, {
      signal: controller.signal,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(rewriter ? { rewriter } : {}),
      ...(deps.inactivityTimeoutMs !== undefined
        ? { inactivityTimeoutMs: deps.inactivityTimeoutMs }
        : {}),
      onBytes: (bytes) => ctx.progress({ phase: 'download', done: bytes }),
      onText: async (text) => {
        parser.write(text);
        chars += text.length;
        if (chars > MAX_DECODED_CHARS || tooMany) throw new XmltvFormatError('too-large');
        if (!parser.sawRoot && chars > SNIFF_CHARS) throw new XmltvFormatError('not-xmltv');
        if (pending.length >= WRITE_BATCH && parser.sawRoot) {
          ctx.throwIfCancelled();
          await flush();
        }
      },
    });
  } finally {
    clearInterval(poll);
  }
  ctx.throwIfCancelled();
  parser.end();
  if (!parser.sawRoot) throw new XmltvFormatError('not-xmltv');
  await flush();
  // Coverage (EPG-03 AC4): channels whose XMLTV channel had programmes in the window.
  let channelsWithEpg = 0;
  for (const id of matcher.assignments().values()) if (withProgrammes.has(id)) channelsWithEpg++;
  return { stored, channelsWithEpg, channels: refs.length };
}
