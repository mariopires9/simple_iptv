// ★ of the details pages (VOD-02, SER-02; shared since SER-02): optimistic toggle with a polite
// announcement; a failed write reverts it (unless a newer toggle superseded it).
// `@/core/db` (Dexie) is imported dynamically: `src/ui` is checked as part of the initial bundle
// (ADR-003, src/app/initialBundle.test.ts), although only the lazy catalogue screens use this.
import { useCallback, useRef, useState } from 'react';

export interface FavoriteTexts {
  favoriteAdded: (name: string) => string;
  favoriteRemoved: (name: string) => string;
  favoriteFailed: (name: string) => string;
}

export function useFavoriteToggle(
  itemKey: string,
  name: string,
  initial: boolean,
  texts: FavoriteTexts,
): { favorite: boolean; toggle: () => void; announcement: string } {
  const [favorite, setFavorite] = useState(initial);
  const [announcement, setAnnouncement] = useState('');
  const version = useRef(0);
  const toggle = useCallback(() => {
    const next = !favorite;
    const mine = ++version.current;
    setFavorite(next);
    setAnnouncement(next ? texts.favoriteAdded(name) : texts.favoriteRemoved(name));
    import('@/core/db')
      .then(({ favoritesRepo }) =>
        next ? favoritesRepo.add(itemKey) : favoritesRepo.remove(itemKey),
      )
      .catch(() => {
        if (version.current !== mine) return;
        setFavorite(!next);
        setAnnouncement(texts.favoriteFailed(name));
      });
  }, [favorite, itemKey, name, texts]);
  return { favorite, toggle, announcement };
}
