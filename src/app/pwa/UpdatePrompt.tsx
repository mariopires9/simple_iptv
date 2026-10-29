// "New version available — Update" (PWA-03 AC1–AC3). Uses the app's toast queue (UX-02) with a
// toast that stays until acted on. Never offered while a player is open (AC2): it is withdrawn
// when playback starts and offered again when the player closes. Renders nothing itself.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { log } from '@/core/log';
import { isPlaybackActive, subscribePlayback } from '@/core/session';
import { t } from '@/i18n';
import { useToast } from '@/ui/state';
import {
  applyServiceWorkerUpdate,
  getServiceWorkerStatus,
  subscribeServiceWorkerStatus,
} from './serviceWorker';

const noPlayback = () => false;
const noUpdate = () => false;

export function UpdatePrompt() {
  const toast = useToast();
  const needRefresh = useSyncExternalStore(
    subscribeServiceWorkerStatus,
    () => getServiceWorkerStatus().needRefresh,
    noUpdate,
  );
  const playing = useSyncExternalStore(subscribePlayback, isPlaybackActive, noPlayback);
  const offer = needRefresh && !playing;
  const shown = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!offer) return undefined;
    shown.current = toast.show({
      message: t.app.update.available,
      durationMs: null,
      action: {
        label: t.app.update.action,
        onClick: () => {
          applyServiceWorkerUpdate().catch((error: unknown) =>
            log.warn('pwa: update could not be applied', { error }),
          );
        },
      },
    });
    return () => {
      if (shown.current !== undefined) toast.dismiss(shown.current);
      shown.current = undefined;
    };
  }, [offer, toast]);

  return null;
}
