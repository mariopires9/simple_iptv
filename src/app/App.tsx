import { Fragment, lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import {
  activeLocale,
  applyPendingLocale,
  installLanguagePreference,
  restoreLanguagePreference,
  subscribeLocale,
} from '@/i18n';
import {
  getVaultLockStatus,
  initVaultLock,
  installVaultAutoLock,
  isPlaybackActive,
  subscribePlayback,
  subscribeVaultLock,
} from '@/core/session';
import { loadLockScreen } from '@/features/settings';
import { hasSources } from '@/features/sources';
import { DpadFocusStyles, installDpadNavigation } from '@/ui/dpad';
import { ToastProvider } from '@/ui/state';
import { ThemeModeProvider } from '@/ui/theme';
import { installChunkReload } from './chunkReload';
import { installDataDeletionWatch } from './dataDeletionWatch';
import { DatabaseUnavailableScreen, useDatabaseCheck } from './DatabaseUnavailableScreen';
import { installResumeOnReconnect } from './pwa/resumeOnReconnect';
import { scheduleIdle, scheduleStartupSync } from './pwa/startupSync';
import { UpdatePrompt } from './pwa/UpdatePrompt';
import { AppRouter, applyStartupRedirect, getAppRouter } from './router';
import { StartupIndicator } from './StartupIndicator';

/** The stored interface language is applied before the router's first render (UX-06). */
function useLanguageRestored(): boolean {
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    let active = true;
    void restoreLanguagePreference().finally(() => {
      if (active) setRestored(true);
    });
    return () => {
      active = false;
    };
  }, []);
  return restored;
}

/**
 * QA-04: the onboarding guard's question (any source?) is asked with the start-up storage check,
 * before the router exists, so a first run starts the router on the onboarding route directly
 * (`applyStartupRedirect`). The answer is cached by features/sources: the guard then decides on
 * its first render. A failed read changes nothing (the guard handles it, as before).
 */
function useStartupSourcesChecked(): boolean {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let active = true;
    void hasSources()
      .then(applyStartupRedirect)
      .catch(() => undefined)
      .finally(() => {
        if (active) setChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return checked;
}

/**
 * SEC-02: whether a master password is set is checked with the other start-up reads (one settings
 * read, in parallel), so it adds no step when it is off. The unlock screen's chunk loads only
 * when it is on.
 */
function useVaultLockChecked(): boolean {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let active = true;
    void initVaultLock()
      .catch(() => undefined)
      .finally(() => {
        if (active) setChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return checked;
}

const LockScreen = lazy(loadLockScreen);

/**
 * Back key (UX-05): one step back in the app's history; nothing on its first entry, so the remote
 * never leaves the app by accident. (React Router keeps the entry's index in `history.state`.)
 */
function goBack(): void {
  const state: unknown = window.history.state;
  const idx = typeof state === 'object' && state !== null ? (state as { idx?: unknown }).idx : 0;
  if (typeof idx === 'number' && idx > 0) void getAppRouter().navigate(-1);
}

export interface AppProps {
  /** Called once per mount, when the first screen is up and the browser is idle (QA-04). */
  onStarted?: () => void;
}

/**
 * Theme and toasts (UX-02), then the start-up storage check, then the hash router (AppShell + lazy screens).
 * With a master password (SEC-02) the unlock screen comes first; a later lock (background
 * timeout) covers the mounted router, whose secret reads wait for the unlock.
 * While the check runs only the themed background is shown (UX_UI §5: short loads do not flash a
 * spinner); it normally takes one IndexedDB open. A longer start (e.g. the schema upgrade of a new
 * version, which runs inside that open: PWA-03 AC4) shows the start-up indicator instead. The
 * update prompt (PWA-03) lives beside the screens, in the toast queue.
 *
 * Interface language (UX-06): screens read `t` while rendering, so a locale switch re-mounts the
 * routed content (keyed by locale) and every visible string changes at once, without a reload.
 * The router is a singleton, so the current route is kept; theme and toasts stay mounted. A
 * re-mount only ever follows the user's own choice in Settings: the stored language is applied
 * before the first render, and a browser language change (preference `system`) waits for the next
 * navigation with no player mounted (`applyPendingLocale`), so it never tears down playback or a
 * form being filled in.
 */
export function App({ onStarted }: AppProps = {}) {
  const db = useDatabaseCheck();
  const languageRestored = useLanguageRestored();
  const sourcesChecked = useStartupSourcesChecked();
  const lockChecked = useVaultLockChecked();
  const locked = useSyncExternalStore(subscribeVaultLock, getVaultLockStatus) === 'locked';
  /** The router has been mounted once: a later lock covers it instead of unmounting it. */
  const [opened, setOpened] = useState(false);
  const locale = useSyncExternalStore(subscribeLocale, activeLocale);
  useEffect(() => installChunkReload(), []);
  // SRC-10: another tab deleted all data → lock the database and restart on onboarding.
  useEffect(() => installDataDeletionWatch(), []);
  // One "player open" signal (TEC-03): the one that also holds app updates (PWA-03).
  useEffect(() => installLanguagePreference(isPlaybackActive, subscribePlayback), []);
  // PWA-04 AC2: scheduled syncs skipped while offline start when the connection returns.
  useEffect(() => installResumeOnReconnect(), []);
  // SEC-02: lock after some minutes in the background.
  useEffect(() => installVaultAutoLock(), []);

  const startupReady = db.status === 'ready' && languageRestored && sourcesChecked && lockChecked;
  // SEC-02: locked on open → nothing that reads secrets mounts before the unlock.
  const routerReady = startupReady && (opened || !locked);
  // Derived during render (no extra effect pass).
  if (routerReady && !opened) setOpened(true);
  // SRC-07 AC5: lists not synced for 24 h are refreshed once the app is up and idle.
  useEffect(() => (routerReady ? scheduleStartupSync() : undefined), [routerReady]);
  // QA-04: work that is not needed for the first screen (the service worker) starts once a screen
  // is up and the browser is idle; the storage-error screen counts (an update may fix it).
  const settled = startupReady || db.status === 'unavailable';
  useEffect(
    () => (settled && onStarted ? scheduleIdle(onStarted) : undefined),
    [settled, onStarted],
  );
  // UX-05: TV remotes — spatial arrows, Back (Escape and the remotes' back keys) goes back.
  useEffect(
    () => (routerReady ? installDpadNavigation({ back: goBack }) : undefined),
    [routerReady],
  );
  useEffect(() => {
    if (!routerReady) return undefined;
    const router = getAppRouter();
    let location = router.state.location;
    return router.subscribe((state) => {
      if (state.location === location) return;
      location = state.location;
      applyPendingLocale();
    });
  }, [routerReady]);

  let content = null;
  if (db.status === 'unavailable') content = <DatabaseUnavailableScreen reason={db.reason} />;
  else if (routerReady) {
    content = (
      <>
        <AppRouter router={getAppRouter()} />
        {locked && (
          <Suspense fallback={null}>
            <LockScreen />
          </Suspense>
        )}
      </>
    );
  } else if (startupReady && locked) {
    content = (
      <Suspense fallback={<StartupIndicator />}>
        <LockScreen />
      </Suspense>
    );
  } else content = <StartupIndicator />;

  return (
    <ThemeModeProvider>
      <DpadFocusStyles />
      <ToastProvider>
        <Fragment key={locale}>{content}</Fragment>
        <UpdatePrompt />
      </ToastProvider>
    </ThemeModeProvider>
  );
}
