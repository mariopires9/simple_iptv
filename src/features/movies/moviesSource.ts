// Active source of the Movies screens: `activeSourceId` from settings, falling back to the first
// source (same rule as `@/core/session`), with its movie categories and "Continue watching"
// progress. Switching lists (SRC-08) notifies `@/core/session`; the screens then load again.
import {
  catalogRepo,
  historyRepo,
  settingsRepo,
  sourcesRepo,
  type HistoryEntry,
  type Source,
} from '@/core/db';
import { buildCategories, type MovieCategory } from './categories';

export type MoviesSourceState =
  | { status: 'loading' }
  | { status: 'no-source' }
  | { status: 'error'; error: unknown }
  | {
      status: 'ready';
      source: Source;
      categories: MovieCategory[];
      /** Keys of the source categories in display order (the segments of "All"). */
      sourceCategoryKeys: string[];
      /** Watched fraction (0–1, exclusive) per movie key with a saved position. */
      progress: ReadonlyMap<string, number>;
    };

export async function resolveActiveSource(): Promise<Source | undefined> {
  const activeId = await settingsRepo.get('activeSourceId');
  const active = activeId === undefined ? undefined : await sourcesRepo.get(activeId);
  return active ?? (await sourcesRepo.list())[0];
}

/** Upper bound of history entries read for the progress bars (one indexed read). */
export const PROGRESS_LIMIT = 5_000;

/** Fraction watched of an entry, or `undefined` when there is nothing to resume. */
export function watchedFraction(entry: HistoryEntry | undefined): number | undefined {
  if (!entry || entry.completed) return undefined;
  const { positionSec, durationSec } = entry;
  if (positionSec === undefined || durationSec === undefined) return undefined;
  if (!(positionSec > 0) || !(durationSec > 0)) return undefined;
  const fraction = positionSec / durationSec;
  return fraction < 1 ? fraction : undefined;
}

export async function loadMoviesSource(): Promise<MoviesSourceState> {
  const source = await resolveActiveSource();
  if (!source) return { status: 'no-source' };
  const [sourceCategories, history] = await Promise.all([
    catalogRepo.listCategories(source.id, 'movie'),
    historyRepo.listRecent(source.id, 'movie', PROGRESS_LIMIT),
  ]);
  const categories = buildCategories(sourceCategories);
  const progress = new Map<string, number>();
  for (const entry of history) {
    const fraction = watchedFraction(entry);
    if (fraction !== undefined) progress.set(entry.itemKey, fraction);
  }
  return {
    status: 'ready',
    source,
    categories,
    sourceCategoryKeys: categories.flatMap((c) => (c.kind === 'source' ? [c.key] : [])),
    progress,
  };
}
