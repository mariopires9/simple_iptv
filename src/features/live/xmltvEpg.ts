// Now/next for M3U lists from their imported XMLTV guide (EPG-02/EPG-03), behind the same
// `EpgService` interface as the Xtream short EPG (EPG-01), so `NowNext` and the channel rows are
// reused unchanged.
//
// Reads come from IndexedDB (`epgRepo.upcoming`, one primary-key range per channel) and are
// cached per channel until the programme on air ends (at most CACHE_TTL_MS). When the screen
// opens and the guide is due (never imported, older than 12 h, or a failure older than 1 h), the
// `importEpg` worker task runs in the background; when it stores a new guide the cache is
// dropped and the current subscribers are told to read again.
import { epgRepo, type Channel, type EpgProgram, type Source } from '@/core/db';
import { log } from '@/core/log';
import { epgUrlsOf, isEpgDue } from '@/providers/xmltv';
import { runTask } from '@/worker';
import { CACHE_TTL_MS, type EpgService, type ShortEpgProgramme } from './epg';

export interface XmltvEpgDeps {
  now?: () => number;
  upcoming?: (channelKey: string, now: number) => Promise<EpgProgram[]>;
  /** Runs the import; resolves with whether a new guide was stored. Default: worker task. */
  importGuide?: (sourceId: string) => Promise<boolean>;
}

interface Entry {
  programmes: readonly ShortEpgProgramme[];
  expires: number;
}

const toShort = (p: EpgProgram): ShortEpgProgramme => {
  const out: ShortEpgProgramme = { title: p.title, start: p.start, end: p.end };
  if (p.desc !== undefined) out.description = p.desc;
  return out;
};

// Not tied to the screen's lifetime: an import started here finishes in the worker even if the
// user leaves (its result is stored for next time).
const defaultImport = async (sourceId: string) => {
  const result = await runTask('importEpg', { sourceId });
  return result.status === 'ok';
};

/**
 * Guide service of an M3U list, or `undefined` for Xtream lists (they use the short EPG) and for
 * lists without any guide URL nor a stored guide.
 */
export function createXmltvEpgService(
  source: Source,
  deps: XmltvEpgDeps = {},
): EpgService | undefined {
  if (source.kind === 'xtream') return undefined;
  const hasUrl = epgUrlsOf(source).length > 0;
  if (!hasUrl && source.epgStatus?.lastOkAt === undefined) return undefined;
  const now = deps.now ?? Date.now;
  const upcoming = deps.upcoming ?? ((key, at) => epgRepo.upcoming(key, at));
  const importGuide = deps.importGuide ?? defaultImport;
  const cache = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<readonly ShortEpgProgramme[]>>();
  const listeners = new Set<() => void>();
  let generation = 0;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const read = (channel: Channel): Promise<readonly ShortEpgProgramme[]> => {
    const pending = inFlight.get(channel.key);
    if (pending) return pending;
    const gen = generation;
    const task = upcoming(channel.key, now())
      .then((rows) => rows.map(toShort))
      .catch((error: unknown) => {
        log.warn('live: reading the guide failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
        return [] as ShortEpgProgramme[];
      })
      .then((programmes) => {
        if (gen === generation) {
          const at = now();
          const firstEnd = programmes[0]?.end ?? Infinity;
          cache.set(channel.key, { programmes, expires: Math.min(at + CACHE_TTL_MS, firstEnd) });
        }
        return programmes;
      })
      .finally(() => inFlight.delete(channel.key));
    inFlight.set(channel.key, task);
    return task;
  };

  if (hasUrl && isEpgDue(source, now())) {
    importGuide(source.id).then(
      (stored) => {
        if (!stored) return;
        generation++;
        cache.clear();
        notify();
      },
      (error: unknown) => {
        log.info('live: guide import did not run', {
          error: error instanceof Error ? error.name : 'unknown',
        });
      },
    );
  }

  return {
    peek(channel) {
      const entry = cache.get(channel.key);
      return entry && now() < entry.expires ? entry.programmes : undefined;
    },
    load(channel, { signal } = {}) {
      const entry = cache.get(channel.key);
      if (entry && now() < entry.expires) return Promise.resolve(entry.programmes);
      if (signal?.aborted) {
        return Promise.reject(new DOMException('EPG request no longer needed', 'AbortError'));
      }
      return read(channel).then((programmes) => {
        if (programmes.length > 0) notify();
        return programmes;
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel() {
      // Reads are local and short; a running import is left to finish in the worker.
    },
  };
}
