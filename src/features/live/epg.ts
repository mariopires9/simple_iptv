// Now/next for Xtream channels (EPG-01) via `get_short_epg` — docs/USER_STORIES.md EPG-01.
//
// One service per active Xtream source:
// - at most MAX_CONCURRENT requests in flight; the rest wait in a queue (the playing channel
//   jumps to its front), and a queued request whose callers all gave up (rows scrolled away)
//   is dropped without being sent;
// - results — including "no EPG", failures and listings whose programmes have all ended — are
//   cached per channel: an entry is fresh until it expires, whatever its programmes say, so a
//   channel is asked at most once per CACHE_TTL_MS. An entry whose last programme ends inside
//   the TTL expires at that end instead, but never sooner than MIN_REFETCH_MS after the fetch
//   (a panel serving stale EPG must not be asked again on every render — QA-02 defect);
// - one request per channel at a time: concurrent callers share the task in flight;
// - HTTP 429: every request pauses for an exponential backoff (5 s → 5 min) and the throttled
//   one is retried after it; a rejected login (auth) turns the service off;
// - `cancel()` (screen unmounted) aborts what is in flight without caching it;
// - the password comes from the vault; the client registers it with the log redactor and the
//   request URL is never logged (only `NetError` kind/status).
import { VaultKeyLostError, credentialVault, type CredentialVault } from '@/core/crypto';
import type { Channel, Source } from '@/core/db';
import { log } from '@/core/log';
import { isNetError, type FetchImpl } from '@/core/net';
import { createXtreamClient, fetchShortEpg, type ShortEpgProgramme } from '@/providers/xtream';

export type { ShortEpgProgramme } from '@/providers/xtream';

/** Programmes asked per channel: the current one and the next. */
export const EPG_LIMIT = 2;
export const MAX_CONCURRENT = 6;
export const CACHE_TTL_MS = 5 * 60_000;
/** A channel is never asked again sooner than this after an answer. */
export const MIN_REFETCH_MS = 60_000;
/** Visible rows settle for this long before their EPG is requested. */
export const SCROLL_DEBOUNCE_MS = 300;
export const BACKOFF_INITIAL_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export interface EpgService {
  /** Cached programmes of `channel` (fresh only); `undefined` when not known yet. */
  peek(channel: Channel): readonly ShortEpgProgramme[] | undefined;
  /**
   * Programmes of `channel` (`[]` when the panel has none or the request failed). `priority`
   * puts it at the front of the queue. Rejects with an `AbortError` when `signal` aborts first.
   */
  load(
    channel: Channel,
    options?: { signal?: AbortSignal; priority?: boolean },
  ): Promise<readonly ShortEpgProgramme[]>;
  /** Called whenever a channel's programmes arrive. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /**
   * Drops the queue and aborts the requests in flight (their callers get `[]`, nothing is
   * cached for them); the service stays usable and keeps its cache and backoff.
   */
  cancel(): void;
}

export interface EpgDeps {
  vault?: Pick<CredentialVault, 'get'>;
  fetchImpl?: FetchImpl;
  now?: () => number;
}

/** The programme on air at `now`, if any. */
export function currentProgramme(
  programmes: readonly ShortEpgProgramme[] | undefined,
  now: number,
): ShortEpgProgramme | undefined {
  return programmes?.find((p) => p.start <= now && now < p.end);
}

/** The first programme starting after the current one (or after `now`). */
export function nextProgramme(
  programmes: readonly ShortEpgProgramme[] | undefined,
  now: number,
): ShortEpgProgramme | undefined {
  const current = currentProgramme(programmes, now);
  const from = current?.end ?? now;
  return programmes?.find((p) => p.start >= from);
}

/** Xtream stream id of a channel (stored bare; tolerate an extension left by older catalogues). */
function streamIdOf(channel: Channel): string {
  return channel.streamPath.replace(/\.[a-z0-9]{2,5}$/i, '');
}

interface Waiter {
  resolve: (value: readonly ShortEpgProgramme[]) => void;
  reject: (reason: unknown) => void;
  detach: () => void;
}

interface Task {
  key: string;
  streamId: string;
  waiters: Set<Waiter>;
  started: boolean;
  /** Throttle episode current when the request was sent (429 backoff bookkeeping). */
  episode: number;
}

interface Entry {
  programmes: readonly ShortEpgProgramme[];
  expires: number;
}

const abortError = () => new DOMException('EPG request no longer needed', 'AbortError');

type Client = Parameters<typeof fetchShortEpg>[0];

/** EPG service of `source`, or `undefined` when it has no `get_short_epg` (M3U sources). */
export function createEpgService(source: Source, deps: EpgDeps = {}): EpgService | undefined {
  if (source.kind !== 'xtream') return undefined;
  const now = deps.now ?? Date.now;
  const cache = new Map<string, Entry>();
  const tasks = new Map<string, Task>();
  const queue: Task[] = [];
  const listeners = new Set<() => void>();
  let active = 0;
  let blockedUntil = 0;
  let backoff = 0;
  // Bumped by every 429 that grows the backoff. A response to a request sent before the latest
  // 429 says nothing new: it neither grows the backoff again (6 parallel 429s are one episode)
  // nor resets it (an older success does not mean the panel stopped throttling).
  let episode = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disabled = false;
  let client: Promise<Client | undefined> | undefined;
  // Aborts the requests in flight on `cancel()` (replaced after each one).
  let stop = new AbortController();

  const getClient = (): Promise<Client | undefined> => {
    client ??= (async () => {
      const { serverUrl, username, secretRef } = source;
      if (!serverUrl || !username || !secretRef) return undefined;
      try {
        const password = await (deps.vault ?? credentialVault).get(secretRef);
        if (password === undefined) return undefined;
        const options: Parameters<typeof createXtreamClient>[0] = {
          baseUrl: serverUrl,
          username,
          password,
        };
        if (deps.fetchImpl) options.fetchImpl = deps.fetchImpl;
        return createXtreamClient(options);
      } catch (error) {
        if (!(error instanceof VaultKeyLostError)) {
          log.warn('live: EPG unavailable', {
            error: error instanceof Error ? error.name : 'unknown',
          });
        }
        return undefined;
      }
    })();
    return client;
  };

  // Fresh until it expires, whatever its programmes say: freshness is decided once, when the
  // answer arrives (see `expiryOf`), so stale listings cannot make every caller ask again.
  const fresh = (entry: Entry | undefined, at: number): boolean =>
    entry !== undefined && at < entry.expires;

  // TTL from the fetch; earlier when the last programme still on air ends inside it (what is on
  // next is not in the entry), but never before MIN_REFETCH_MS. Listings that are empty or have
  // already ended keep the full TTL.
  const expiryOf = (programmes: readonly ShortEpgProgramme[], at: number): number => {
    const ttl = at + CACHE_TTL_MS;
    const lastEnd = programmes.reduce((max, p) => Math.max(max, p.end), -Infinity);
    if (lastEnd <= at || lastEnd >= ttl) return ttl;
    return Math.max(lastEnd, at + MIN_REFETCH_MS);
  };

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const settle = (task: Task, programmes: readonly ShortEpgProgramme[]) => {
    // A cancelled task may finish after a new one for the same channel was queued.
    if (tasks.get(task.key) === task) tasks.delete(task.key);
    for (const waiter of task.waiters) {
      waiter.detach();
      waiter.resolve(programmes);
    }
    task.waiters.clear();
  };

  const pump = () => {
    if (disabled) return;
    const at = now();
    if (at < blockedUntil) {
      if (timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined;
          pump();
        }, blockedUntil - at);
      }
      return;
    }
    while (active < MAX_CONCURRENT && queue.length > 0) {
      const task = queue.shift() as Task;
      void run(task);
    }
  };

  /** Credentials rejected: nothing more is asked; every caller gets "no EPG". */
  const disable = () => {
    disabled = true;
    queue.length = 0;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    stop.abort();
    stop = new AbortController();
    for (const task of [...tasks.values()]) settle(task, []);
  };

  const run = async (task: Task) => {
    task.started = true;
    task.episode = episode;
    active++;
    const { signal } = stop;
    try {
      const c = await getClient();
      if (signal.aborted) {
        settle(task, []);
        return;
      }
      const programmes =
        c && !disabled ? await fetchShortEpg(c, task.streamId, EPG_LIMIT, signal) : [];
      if (task.episode === episode) backoff = 0;
      const at = now();
      cache.set(task.key, { programmes, expires: expiryOf(programmes, at) });
      settle(task, programmes);
      if (programmes.length > 0) notify();
    } catch (error) {
      if (signal.aborted) {
        // Cancelled: not an answer about this channel, so nothing is cached.
        settle(task, []);
      } else if (isNetError(error) && error.status === 429 && !disabled) {
        if (task.episode === episode) {
          episode++;
          backoff = backoff === 0 ? BACKOFF_INITIAL_MS : Math.min(backoff * 2, BACKOFF_MAX_MS);
          blockedUntil = Math.max(blockedUntil, now() + backoff);
        }
        task.started = false;
        if (task.waiters.size > 0) queue.unshift(task);
        else settle(task, []);
      } else {
        // Anything else (no EPG endpoint, HTML page, timeout…): nothing to show for a while.
        cache.set(task.key, { programmes: [], expires: now() + CACHE_TTL_MS });
        settle(task, []);
        if (isNetError(error) && error.kind === 'auth' && !disabled) disable();
      }
    } finally {
      active--;
      pump();
    }
  };

  return {
    peek(channel) {
      const entry = cache.get(channel.key);
      return fresh(entry, now()) ? entry?.programmes : undefined;
    },

    load(channel, { signal, priority = false } = {}) {
      const entry = cache.get(channel.key);
      if (fresh(entry, now())) return Promise.resolve(entry?.programmes ?? []);
      if (disabled) return Promise.resolve([]);
      if (signal?.aborted) return Promise.reject(abortError());
      return new Promise((resolve, reject) => {
        let task = tasks.get(channel.key);
        if (!task) {
          task = {
            key: channel.key,
            streamId: streamIdOf(channel),
            waiters: new Set(),
            started: false,
            episode: 0,
          };
          tasks.set(channel.key, task);
          if (priority) queue.unshift(task);
          else queue.push(task);
        } else if (priority && !task.started) {
          const at = queue.indexOf(task);
          if (at > 0) {
            queue.splice(at, 1);
            queue.unshift(task);
          }
        }
        const owner = task;
        const onAbort = () => {
          owner.waiters.delete(waiter);
          reject(abortError());
          if (!owner.started && owner.waiters.size === 0) {
            const at = queue.indexOf(owner);
            if (at >= 0) queue.splice(at, 1);
            tasks.delete(owner.key);
          }
        };
        const waiter: Waiter = {
          resolve,
          reject,
          detach: () => signal?.removeEventListener('abort', onAbort),
        };
        task.waiters.add(waiter);
        signal?.addEventListener('abort', onAbort, { once: true });
        pump();
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    cancel() {
      stop.abort();
      stop = new AbortController();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      queue.length = 0;
      for (const task of [...tasks.values()]) settle(task, []);
    },
  };
}
