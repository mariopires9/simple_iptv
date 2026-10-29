// Persisted Live navigation state (LIV-03): per source, the last category, the selected
// (keyboard-active) channel and the list's scroll offset; plus the "Play last channel on open"
// preference (off by default — mobile data and autoplay, LIV-03 AC2) and the last played channel.
//
// Storage: the `settings` table. `lastChannelKey` is a typed key of `SettingsMap` (and is already
// cleared by `sourcesRepo.remove`). `liveViewState` and `playLastChannelOnOpen` are not in
// `SettingsMap` yet (core/db is outside this story's scope; requested in the LIV-03 report), so
// they go through a narrow, local view of the repository and are validated on read like any other
// untrusted input: an unusable record is ignored, never thrown.
import * as v from 'valibot';
import { parseItemKey, settingsRepo } from '@/core/db';
import { log } from '@/core/log';

export interface SavedLiveView {
  /** Route id of the category (`VIRTUAL_CATEGORY_IDS` or a source category's external id). */
  categoryId: string;
  /** Key of the selected row's channel, when its page was loaded. */
  selectedKey?: string;
  /** Row of the selection in that category. */
  selectedIndex: number;
  /** `scrollTop` of the channel list, in px. */
  scrollTop: number;
  savedAt: number;
}

const LIVE_VIEW_KEY = 'liveViewState';
export const PLAY_LAST_CHANNEL_KEY = 'playLastChannelOnOpen';

const store = settingsRepo;

/** At most this many sources keep a saved view (the oldest is dropped). */
export const MAX_SAVED_VIEWS = 20;
/** Upper bound of a stored offset/index: anything larger is corrupt. */
const MAX_OFFSET = 10_000_000;

const ViewSchema = v.object({
  categoryId: v.pipe(v.string(), v.minLength(1), v.maxLength(512)),
  selectedKey: v.optional(v.pipe(v.string(), v.maxLength(1024))),
  selectedIndex: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_OFFSET)),
  scrollTop: v.pipe(v.number(), v.minValue(0), v.maxValue(MAX_OFFSET * 100)),
  savedAt: v.pipe(v.number(), v.finite()),
});

/** Valid saved views by source id; unusable entries are dropped one by one. */
function readViews(raw: unknown): Map<string, SavedLiveView> {
  const views = new Map<string, SavedLiveView>();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return views;
  for (const [sourceId, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = v.safeParse(ViewSchema, value);
    if (!parsed.success) continue;
    const view: SavedLiveView = {
      categoryId: parsed.output.categoryId,
      selectedIndex: parsed.output.selectedIndex,
      scrollTop: parsed.output.scrollTop,
      savedAt: parsed.output.savedAt,
    };
    if (parsed.output.selectedKey !== undefined) view.selectedKey = parsed.output.selectedKey;
    views.set(sourceId, view);
  }
  return views;
}

function warn(message: string, error: unknown): void {
  log.warn(message, { error: error instanceof Error ? error.name : 'unknown' });
}

/** Writes run one after another, so two read-modify-write cycles never interleave. */
let writes: Promise<void> = Promise.resolve();

export interface LiveStartup {
  view: SavedLiveView | undefined;
  playLastChannelOnOpen: boolean;
  /** The last played channel, only if it belongs to the source. */
  lastChannelKey: string | undefined;
}

/** What the Live screen needs to restore itself for `sourceId`; never throws. */
export async function loadLiveStartup(sourceId: string): Promise<LiveStartup> {
  // A pending save of this session must land first (e.g. back to Live from another screen).
  await writes;
  const [rawViews, playLast, lastChannelKey] = await Promise.all([
    store
      .get(LIVE_VIEW_KEY)
      .catch((error: unknown) => warn('live: reading the view failed', error)),
    store
      .get(PLAY_LAST_CHANNEL_KEY)
      .catch((error: unknown) => warn('live: reading a setting failed', error)),
    settingsRepo
      .get('lastChannelKey')
      .catch((error: unknown) => warn('live: reading the last channel failed', error)),
  ]);
  const ownChannel =
    typeof lastChannelKey === 'string' && parseItemKey(lastChannelKey)?.sourceId === sourceId
      ? lastChannelKey
      : undefined;
  return {
    view: readViews(rawViews).get(sourceId),
    playLastChannelOnOpen: playLast === true,
    lastChannelKey: ownChannel,
  };
}

/** Saves the view of `sourceId` (keeps the other sources' views). */
export function saveLiveView(sourceId: string, view: SavedLiveView): Promise<void> {
  writes = writes.then(async () => {
    try {
      const views = readViews(await store.get(LIVE_VIEW_KEY));
      views.delete(sourceId);
      views.set(sourceId, view);
      const kept = [...views]
        .sort(([, a], [, b]) => b.savedAt - a.savedAt)
        .slice(0, MAX_SAVED_VIEWS);
      await store.set(LIVE_VIEW_KEY, Object.fromEntries(kept));
    } catch (error) {
      warn('live: saving the view failed', error);
    }
  });
  return writes;
}

/** Remembers the last played channel (for "Play last channel on open"). */
export function saveLastChannel(key: string): Promise<void> {
  writes = writes.then(() =>
    settingsRepo
      .set('lastChannelKey', key)
      .catch((error: unknown) => warn('live: saving the last channel failed', error)),
  );
  return writes;
}

/** Forgets every saved view, the last channel and the preference (after pending writes). */
export function clearLiveState(): Promise<void> {
  writes = writes.then(async () => {
    try {
      await Promise.all([
        settingsRepo.remove(LIVE_VIEW_KEY),
        settingsRepo.remove(PLAY_LAST_CHANNEL_KEY),
        settingsRepo.remove('lastChannelKey'),
      ]);
    } catch (error) {
      warn('live: clearing the saved state failed', error);
    }
  });
  return writes;
}

/** "Play last channel on open" (no settings UI yet: UX-04). */
export async function setPlayLastChannelOnOpen(enabled: boolean): Promise<void> {
  await store.set(PLAY_LAST_CHANNEL_KEY, enabled);
}

/** Delay before a view change is written (scrolling fires many). */
export const SAVE_DEBOUNCE_MS = 400;

export interface ViewSaver {
  schedule(sourceId: string, view: SavedLiveView): void;
  /** Writes the pending view now (unmount, page hidden). */
  flush(): void;
}

/** Debounced `saveLiveView`: only the latest view within `delayMs` is written. */
export function createViewSaver(delayMs = SAVE_DEBOUNCE_MS): ViewSaver {
  let pending: { sourceId: string; view: SavedLiveView } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const { sourceId, view } = pending;
    pending = undefined;
    void saveLiveView(sourceId, view);
  };
  return {
    schedule(sourceId, view) {
      if (pending && pending.sourceId !== sourceId) flush();
      pending = { sourceId, view };
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
  };
}
