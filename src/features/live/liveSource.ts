// Active source of the Live screen: `activeSourceId` from settings, falling back to the first
// source, with its categories and favourite channels. Switching lists (SRC-08) persists the
// setting first and then notifies `@/core/session`; the Live screen then loads again from here.
import { catalogRepo, favoritesRepo, settingsRepo, sourcesRepo, type Source } from '@/core/db';
import { buildCategories, type LiveCategory } from './categories';

export type LiveSourceState =
  | { status: 'loading' }
  | { status: 'no-source' }
  | { status: 'error'; error: unknown }
  | {
      status: 'ready';
      source: Source;
      categories: LiveCategory[];
      /** Keys of the source categories in display order (the segments of "All"). */
      sourceCategoryKeys: string[];
      favoriteKeys: string[];
      /**
       * Settings › Playback "Hide protected content" (UX-07), applied to this source: `false` when
       * the source has no protected channels — Xtream ones are never flagged, and an M3U import
       * records how many it wrote (`protectedCounts`) — so nothing is filtered or walked.
       */
      hideProtected: boolean;
    };

export async function resolveActiveSource(): Promise<Source | undefined> {
  const activeId = await settingsRepo.get('activeSourceId');
  const active = activeId === undefined ? undefined : await sourcesRepo.get(activeId);
  return active ?? (await sourcesRepo.list())[0];
}

export async function loadLiveSource(): Promise<LiveSourceState> {
  const source = await resolveActiveSource();
  if (!source) return { status: 'no-source' };
  const [sourceCategories, favorites, hide] = await Promise.all([
    catalogRepo.listCategories(source.id, 'live'),
    favoritesRepo.list(source.id, 'live'),
    settingsRepo.get('hideProtectedContent'),
  ]);
  const categories = buildCategories(sourceCategories);
  return {
    status: 'ready',
    source,
    categories,
    sourceCategoryKeys: categories.flatMap((c) => (c.kind === 'source' ? [c.key] : [])),
    favoriteKeys: favorites.map((f) => f.itemKey),
    hideProtected:
      hide === true &&
      source.kind !== 'xtream' &&
      // Unknown (imported before UX-07): filter, to be safe.
      (source.protectedCounts?.live ?? 1) > 0,
  };
}
