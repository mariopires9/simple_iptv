// Settings › Parental control (SEC-03): the active list's categories per type, to choose which
// ones the PIN restricts. The PIN itself and the restrictions live in `@/core/session`.
import { catalogRepo, sourcesRepo, typePrefix, type Category, type ContentType } from '@/core/db';
import { loadActiveSource } from '@/core/session';
import { setRestrictedCategories } from '@/core/session/parental';
import { UNCATEGORIZED_CATEGORY_ID } from '@/providers/m3u';

export const PARENTAL_TYPES: readonly ContentType[] = ['live', 'movie', 'series'];

export interface CategoryChoice {
  key: string;
  /** Display name; empty for the synthetic "Uncategorized" category (localised by the UI). */
  name: string;
  uncategorized: boolean;
}

export interface ParentalCategories {
  sourceId: string;
  sourceName: string;
  byType: Record<ContentType, CategoryChoice[]>;
}

function toChoice(category: Category): CategoryChoice {
  const uncategorized = category.externalId === UNCATEGORIZED_CATEGORY_ID && category.name === '';
  return { key: category.key, name: category.name, uncategorized };
}

/** The active list's categories of every type, in display order; `undefined` without lists. */
export async function loadParentalCategories(): Promise<ParentalCategories | undefined> {
  const activeId = await loadActiveSource();
  const source = activeId === undefined ? undefined : await sourcesRepo.get(activeId);
  if (!source) return undefined;
  const lists = await Promise.all(
    PARENTAL_TYPES.map((type) => catalogRepo.listCategories(source.id, type)),
  );
  const byType = {} as Record<ContentType, CategoryChoice[]>;
  PARENTAL_TYPES.forEach((type, i) => {
    byType[type] = [...(lists[i] ?? [])].sort((a, b) => a.order - b.order).map(toChoice);
  });
  return { sourceId: source.id, sourceName: source.name, byType };
}

/** Saves the restricted categories of one list and type (the others are kept). */
export function saveRestrictedCategories(
  sourceId: string,
  type: ContentType,
  keys: readonly string[],
): Promise<void> {
  return setRestrictedCategories(typePrefix(sourceId, type), keys);
}
