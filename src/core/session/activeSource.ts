// Active list of the session (SRC-08 AC4): which saved list every screen uses. Framework-agnostic
// store over the `activeSourceId` setting; the UI wraps it with `useSyncExternalStore`.
//
// The published id is the EFFECTIVE one: the stored list when it still exists, otherwise the
// first list in creation order (the fallback every screen applies). Subscribers are notified only
// when that effective id changes (or becomes known), so storing the id that is already active by
// fallback is not a change. `setActiveSource` persists first and then publishes, so a screen that
// reloads on the notification reads the new setting.
//
// `@/core/db` (Dexie) is imported dynamically: modules that reach this one from the initial
// bundle must not pull it in.

export interface ActiveSourceSnapshot {
  /** Effective active list; `undefined` when there is none (or while not known). */
  readonly id: string | undefined;
  /** Whether `id` has been resolved from storage. */
  readonly known: boolean;
}

const UNKNOWN: ActiveSourceSnapshot = { id: undefined, known: false };

let snapshot: ActiveSourceSnapshot = UNKNOWN;
/** Bumped by every write/forget: an older read must not overwrite a newer answer. */
let generation = 0;
let reading: Promise<string | undefined> | undefined;
const listeners = new Set<() => void>();

function publish(next: ActiveSourceSnapshot): void {
  if (next.known === snapshot.known && next.id === snapshot.id) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

export function getActiveSourceSnapshot(): ActiveSourceSnapshot {
  return snapshot;
}

export function subscribeActiveSource(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The effective active list from storage (stored id if it exists, else the first list). */
async function readEffectiveId(): Promise<string | undefined> {
  const { settingsRepo, sourcesRepo } = await import('@/core/db');
  const [stored, sources] = await Promise.all([
    settingsRepo.get('activeSourceId'),
    sourcesRepo.list(),
  ]);
  if (stored !== undefined && sources.some((s) => s.id === stored)) return stored;
  return sources[0]?.id;
}

/**
 * Re-reads the effective active list (after lists were added or removed) and publishes it if it
 * changed. Always a fresh read; when several overlap, the latest one wins.
 */
export function refreshActiveSource(): Promise<string | undefined> {
  const startedAt = ++generation;
  const current = readEffectiveId();
  reading = current;
  const settle = () => {
    if (reading === current) reading = undefined;
  };
  current.then((id) => {
    settle();
    if (startedAt === generation) publish({ id, known: true });
  }, settle);
  return current;
}

/** Resolves the active list on first use; later calls (and concurrent ones) share the answer. */
export function loadActiveSource(): Promise<string | undefined> {
  if (snapshot.known) return Promise.resolve(snapshot.id);
  return reading ?? refreshActiveSource();
}

/**
 * Makes `id` the active list (`undefined` clears the setting, so the first list is used):
 * persisted to the settings, then published if the effective list changed.
 */
export async function setActiveSource(id: string | undefined): Promise<void> {
  const { settingsRepo } = await import('@/core/db');
  if (id === undefined) await settingsRepo.remove('activeSourceId');
  else await settingsRepo.set('activeSourceId', id);
  generation++;
  reading = undefined;
  const startedAt = generation;
  const effective = await readEffectiveId();
  if (startedAt === generation) publish({ id: effective, known: true });
}

/** Forgets the cached answer (after "delete all data", and in tests). */
export function forgetActiveSource(): void {
  generation++;
  reading = undefined;
  publish(UNKNOWN);
}
