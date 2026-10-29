import { useSyncExternalStore } from 'react';
import {
  installPromptStore,
  type InstallOutcome,
  type InstallPromptStore,
  type InstallState,
} from '@/core/platform';

export interface InstallPrompt {
  state: InstallState;
  /** Shows the browser's install dialog when `state` is `available`. */
  promptInstall(): Promise<InstallOutcome>;
}

/**
 * Install state for the UI (PWA-01 AC3): `available` on Chrome/Edge after `beforeinstallprompt`,
 * `ios` on iPhone/iPad (manual "Add to Home Screen"), `installed` in standalone mode or after
 * `appinstalled`, else `unsupported`.
 */
export function useInstallPrompt(store: InstallPromptStore = installPromptStore()): InstallPrompt {
  const state = useSyncExternalStore(store.subscribe, store.getState, () => 'unsupported' as const);
  return { state, promptInstall: store.prompt };
}
