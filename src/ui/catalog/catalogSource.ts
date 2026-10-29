// Active source of the poster-grid screens (Movies, Series; shared since SER-01):
// `activeSourceId` from settings, falling back to the first source (same rule as
// `@/core/session`), with the type's categories and the "Continue watching" progress. Switching
// lists (SRC-08) notifies `@/core/session`; the screens then load again.
// `@/core/db` (Dexie) is imported dynamically: `src/ui` is checked as part of the initial bundle
// (ADR-003, src/app/initialBundle.test.ts), although only the lazy catalogue screens use this.
import type { Category, HistoryEntry, Source } from '@/core/db';
import { watchedFraction } from '@/ui/vod/resume';
import { buildCatalogCategories, type CatalogCategory, type CategoryNames } from './categories';
import type { PosterType } from './sortIndex';

export type CatalogSourceState =
  | { status: 'loading' }
  | { status: 'no-source' }
  | { status: 'error'; error: unknown }
  | {
      status: 'ready';
      source: Source;
      categories: CatalogCategory[];
      /** Keys of the source categories in display order (the segments of "All"). */
      sourceCategoryKeys: string[];
      /** Watched fraction (0–1, exclusive) per started, not completed item key. */
      progress: ReadonlyMap<string, number>;
      /** Settings › Playback "Hide protected content" (UX-07). */
      hideProtected: boolean;
    };

export async function resolveActiveSource(): Promise<Source | undefined> {
  const { settingsRepo, sourcesRepo } = await import('@/core/db');
  const activeId = await settingsRepo.get('activeSourceId');
  const active = activeId === undefined ? undefined : await sourcesRepo.get(activeId);
  return active ?? (await sourcesRepo.list())[0];
}

/** Upper bound of history entries read for the progress bars (one indexed read). */
export const PROGRESS_LIMIT = 5_000;

export interface CatalogSourceOptions {
  names: CategoryNames;
  /** Read "Continue watching" progress bars from the history (movies). */
  progress: boolean;
}

export async function loadCatalogSource(
  type: PosterType,
  options: CatalogSourceOptions,
): Promise<CatalogSourceState> {
  const source = await resolveActiveSource();
  if (!source) return { status: 'no-source' };
  const { catalogRepo, historyRepo, settingsRepo } = await import('@/core/db');
  const [sourceCategories, history, hide]: [Category[], HistoryEntry[], boolean | undefined] =
    await Promise.all([
      catalogRepo.listCategories(source.id, type),
      options.progress ? historyRepo.listRecent(source.id, type, PROGRESS_LIMIT) : [],
      settingsRepo.get('hideProtectedContent'),
    ]);
  const categories = buildCatalogCategories(sourceCategories, options.names);
  const progress = new Map<string, number>();
  for (const entry of history) {
    // Grid bars show any started, not completed item (VOD-01 AC4); Home's "Continue watching"
    // lists only those worth resuming (`continueWatchingProgress`, `@/ui/vod/resume`).
    const fraction = watchedFraction(entry);
    if (fraction !== undefined) progress.set(entry.itemKey, fraction);
  }
  return {
    status: 'ready',
    source,
    categories,
    sourceCategoryKeys: categories.flatMap((c) => (c.kind === 'source' ? [c.key] : [])),
    progress,
    hideProtected: hide === true,
  };
}
