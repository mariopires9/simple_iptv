// Persistent storage and quota (PWA-05, docs/SECURITY.md §4): `navigator.storage.persist()` so the
// browser does not evict the lists and catalog under storage pressure, and `estimate()` for the
// space used. Every API is optional (older Safari has neither `persisted` nor `estimate`), and
// every call is injectable for tests.

/** The parts of `StorageManager` this module uses (all optional: feature-detected). */
export interface StorageManagerLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

/** `persisted`: `undefined` when the browser cannot tell (no `persisted()`, or it failed). */
export interface StorageStatus {
  persisted: boolean | undefined;
  /** `persist()` exists: the app can ask (again), even where `persisted()` is missing. */
  canPersist: boolean;
  /** Bytes used by this origin (`estimate().usage`). */
  usage?: number;
  /** Bytes this origin may use (`estimate().quota`). */
  quota?: number;
}

function browserStorage(): StorageManagerLike | undefined {
  return (globalThis.navigator as { storage?: StorageManagerLike } | undefined)?.storage;
}

/**
 * Asks the browser to keep this origin's data (PWA-05 AC1). Resolves `true`/`false` with the
 * browser's answer, or `undefined` when the API is missing or fails. Never throws.
 */
export async function requestPersistentStorage(
  storage: StorageManagerLike | undefined = browserStorage(),
): Promise<boolean | undefined> {
  if (typeof storage?.persist !== 'function') return undefined;
  try {
    // Already persisted: no need to ask again (Firefox would prompt again).
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return undefined;
  }
}

/** Whether the data is persisted and how much space it uses. Never throws. */
export async function getStorageStatus(
  storage: StorageManagerLike | undefined = browserStorage(),
): Promise<StorageStatus> {
  const [persisted, estimate] = await Promise.all([
    typeof storage?.persisted === 'function'
      ? storage.persisted().catch(() => undefined)
      : Promise.resolve(undefined),
    typeof storage?.estimate === 'function'
      ? storage.estimate().catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
  const status: StorageStatus = { persisted, canPersist: typeof storage?.persist === 'function' };
  if (typeof estimate?.usage === 'number') status.usage = estimate.usage;
  if (typeof estimate?.quota === 'number') status.quota = estimate.quota;
  return status;
}

/** The parts of `window` that tell an installed (home screen) app apart. */
export interface DisplayModeEnv {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
}

/**
 * Whether the app runs installed (standalone display mode, or iOS's home-screen web app flag).
 * Safari deletes the data of a site that is not installed after 7 days without use (PWA-05 AC2).
 */
export function isInstalledApp(env: DisplayModeEnv = globalThis as DisplayModeEnv): boolean {
  if (env.navigator?.standalone === true) return true;
  try {
    return (
      env.matchMedia?.('(display-mode: standalone)').matches === true ||
      env.matchMedia?.('(display-mode: fullscreen)').matches === true
    );
  } catch {
    return false;
  }
}
