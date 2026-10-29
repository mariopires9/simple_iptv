// React binding of the connectivity store (PWA-04). Imported from the module itself (not the
// `@/core/net` barrel) because the offline banner is in the initial bundle.
import { useSyncExternalStore } from 'react';
import {
  connectivity,
  type ConnectivityStatus,
  type ConnectivityStore,
} from '@/core/net/connectivity';

const serverSnapshot = (): ConnectivityStatus => 'online';

/** Current connectivity status; re-renders on change. */
export function useConnectivity(store: ConnectivityStore = connectivity): ConnectivityStatus {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);
}

/**
 * Whether network actions (refresh, add a list, test a connection, play) are blocked: the browser
 * reports no network. See `isNetworkBlocked` in core/net.
 */
export function useNetworkBlocked(store: ConnectivityStore = connectivity): boolean {
  return useConnectivity(store) === 'offline';
}
