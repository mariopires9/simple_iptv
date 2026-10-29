// The stored "Fullscreen in landscape" setting (Settings › Playback, UX-04) for PlayerView's
// rotation prompt (PLY-03 AC3). Read once per player mount; `undefined` until read, when nothing
// is stored, or when the database is unavailable (the player then keeps its default).
import { useEffect, useState } from 'react';

/** Last value read: a player mounted again starts with it instead of the default. */
let lastRead: boolean | undefined;

export function useFullscreenOnLandscapeSetting(enabled = true): boolean | undefined {
  const [value, setValue] = useState<boolean | undefined>(lastRead);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    // Dexie is loaded on demand: the player chunk does not pull it in statically.
    import('@/core/db')
      .then(({ settingsRepo }) => settingsRepo.get('fullscreenOnLandscape'))
      .then(
        (stored) => {
          lastRead = typeof stored === 'boolean' ? stored : undefined;
          if (active) setValue(lastRead);
        },
        () => undefined, // database unavailable: keep the default
      );
    return () => {
      active = false;
    };
  }, [enabled]);
  return value;
}

/** Tests only: forget the last value read. */
export function resetFullscreenOnLandscapeSettingForTests(): void {
  lastRead = undefined;
}
