// Module core/platform — see docs/ARCHITECTURE.md §3. Capability detection (PLY-01), persistent
// storage and quota (PWA-05).
export { browserEnv, getCapabilities } from './capabilities';
export type { Capabilities, MediaSourceLike, PlatformEnv, ProbeVideoLike } from './capabilities';
export { getStorageStatus, isInstalledApp, requestPersistentStorage } from './storage';
export type { DisplayModeEnv, StorageManagerLike, StorageStatus } from './storage';
