// Active source of the Live screen: `activeSourceId` from settings, falling back to the first
// source (the source selector itself is SRC-08), with its categories and favourite channels.
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
    };

export async function resolveActiveSource(): Promise<Source | undefined> {
  const activeId = await settingsRepo.get('activeSourceId');
  const active = activeId === undefined ? undefined : await sourcesRepo.get(activeId);
  return active ?? (await sourcesRepo.list())[0];
}

export async function loadLiveSource(): Promise<LiveSourceState> {
  const source = await resolveActiveSource();
  if (!source) return { status: 'no-source' };
  const [sourceCategories, favorites] = await Promise.all([
    catalogRepo.listCategories(source.id, 'live'),
    favoritesRepo.list(source.id, 'live'),
  ]);
  const categories = buildCategories(sourceCategories);
  return {
    status: 'ready',
    source,
    categories,
    sourceCategoryKeys: categories.flatMap((c) => (c.kind === 'source' ? [c.key] : [])),
    favoriteKeys: favorites.map((f) => f.itemKey),
  };
}
