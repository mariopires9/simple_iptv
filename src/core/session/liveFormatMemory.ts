// Learned live format per channel (PLY-07): the container ('ts' | 'hls') that last actually
// started playing for a channel, so its next play tries that one first (the other stays as the
// fallback). See docs/ARCHITECTURE.md §6.2 for the precedence.
//
// - Keyed by device class and channel key (`${sourceId}:live:${externalId}`, so per source):
//   a format that played on an iPhone (`native-hls`) says nothing about a desktop (`mse`), and
//   the other way round. Never a URL.
// - Kept in memory: a lookup on the play path is synchronous (zapping never waits on IndexedDB).
//   The stored copy is read once (`loadLearnedFormats`) and written debounced, off the play path.
// - Stored in the `liveFormatMemory` setting (so "Delete all data" clears it), oldest first,
//   capped at MAX_LEARNED_FORMATS (the least recently learned go first). Untrusted on read:
//   validated entry by entry; a corrupt value is ignored.
//
// Imported from `@/core/session/liveFormatMemory` directly (not the barrel, which is in the
// initial bundle): only the lazy Live and Settings screens need it. Like the rest of
// core/session, `@/core/db` is imported dynamically (ADR-003 initial-bundle guard).
import * as v from 'valibot';
import { log } from '@/core/log';

const settings = async () => (await import('@/core/db')).settingsRepo;

export type LearnedContainer = 'ts' | 'hls';
/** How the device plays live streams (see `liveDeviceClass` in features/live). */
export type LiveDeviceClass = 'mse' | 'native-hls';

export const MAX_LEARNED_FORMATS = 5000;
/** Delay before a learned format is written (a burst of zaps is one write). */
export const LEARNED_FORMATS_WRITE_DELAY_MS = 2000;

const STORAGE_VERSION = 1;

/** Stored entry: `[deviceClass, channelKey, container]`. */
const ENTRY = v.tuple([
  v.picklist(['mse', 'native-hls'] as const),
  v.pipe(v.string(), v.minLength(1), v.maxLength(512)),
  v.picklist(['ts', 'hls'] as const),
]);

const SEP = '|';
const memoryKey = (deviceClass: LiveDeviceClass, channelKey: string) =>
  `${deviceClass}${SEP}${channelKey}`;
const channelOf = (key: string) => key.slice(key.indexOf(SEP) + 1);

/** Tolerant: invalid entries are skipped; anything but the expected shape reads as empty. */
export function parseLearnedFormats(stored: unknown): Map<string, LearnedContainer> {
  const map = new Map<string, LearnedContainer>();
  if (typeof stored !== 'object' || stored === null) return map;
  const { version, entries } = stored as Record<string, unknown>;
  if (version !== STORAGE_VERSION || !Array.isArray(entries)) return map;
  for (const item of entries.slice(-MAX_LEARNED_FORMATS)) {
    const parsed = v.safeParse(ENTRY, item);
    if (!parsed.success) continue;
    const [deviceClass, channelKey, container] = parsed.output;
    const key = memoryKey(deviceClass, channelKey);
    map.delete(key);
    map.set(key, container);
  }
  return map;
}

/** In insertion order = least recently learned first. */
let cache: Map<string, LearnedContainer> | undefined;
let loading: Promise<void> | undefined;
let writeTimer: ReturnType<typeof setTimeout> | undefined;

function memory(): Map<string, LearnedContainer> {
  cache ??= new Map();
  return cache;
}

function evict(map: Map<string, LearnedContainer>): void {
  for (const key of map.keys()) {
    if (map.size <= MAX_LEARNED_FORMATS) return;
    map.delete(key);
  }
}

async function write(): Promise<void> {
  if (writeTimer !== undefined) clearTimeout(writeTimer);
  writeTimer = undefined;
  const entries = [...memory()].map(([key, container]) => [
    key.slice(0, key.indexOf(SEP)),
    channelOf(key),
    container,
  ]);
  await (await settings()).set('liveFormatMemory', { version: STORAGE_VERSION, entries });
}

function scheduleWrite(): void {
  if (writeTimer !== undefined) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = undefined;
    write().catch((error: unknown) =>
      log.warn('live: the learned formats could not be saved', { error }),
    );
  }, LEARNED_FORMATS_WRITE_DELAY_MS);
}

/**
 * Reads the stored formats once (later calls return the same promise). Never rejects: an
 * unreadable value is ignored. Formats learned meanwhile win over the stored ones.
 */
export function loadLearnedFormats(): Promise<void> {
  loading ??= settings()
    .then((repo) => repo.get('liveFormatMemory'))
    .then(parseLearnedFormats, (error: unknown) => {
      log.warn('live: the learned formats could not be read', { error });
      return new Map<string, LearnedContainer>();
    })
    .then((stored) => {
      const learned = cache ?? new Map<string, LearnedContainer>();
      cache = stored;
      for (const [key, container] of learned) {
        stored.delete(key);
        stored.set(key, container);
      }
      evict(stored);
    });
  return loading;
}

/** The container that last started for `channelKey` on this device class (synchronous). */
export function learnedFormat(
  channelKey: string,
  deviceClass: LiveDeviceClass,
): LearnedContainer | undefined {
  return cache?.get(memoryKey(deviceClass, channelKey));
}

/** Remembers the container that just started for `channelKey` (saved debounced). */
export function rememberFormat(
  channelKey: string,
  deviceClass: LiveDeviceClass,
  container: LearnedContainer,
): void {
  const map = memory();
  const key = memoryKey(deviceClass, channelKey);
  const unchanged = map.get(key) === container;
  // Most recently learned last (least recently learned evicted first).
  map.delete(key);
  map.set(key, container);
  evict(map);
  // Only a change is worth a write; the new order is saved with the next one.
  if (!unchanged) scheduleWrite();
}

/** Writes a pending change now (tests; a caller about to leave). */
export async function flushLearnedFormats(): Promise<void> {
  if (writeTimer !== undefined) await write();
}

/** Forgets every learned format of a list (Settings › Playback, a removed list). */
export async function resetLearnedFormats(sourceId: string): Promise<void> {
  await loadLearnedFormats();
  const prefix = (await import('@/core/db')).sourcePrefix(sourceId);
  const map = memory();
  for (const key of [...map.keys()]) if (channelOf(key).startsWith(prefix)) map.delete(key);
  await write();
}

/** Tests only: forget the in-memory state and any pending write. */
export function resetLearnedFormatsForTests(): void {
  if (writeTimer !== undefined) clearTimeout(writeTimer);
  writeTimer = undefined;
  cache = undefined;
  loading = undefined;
}
