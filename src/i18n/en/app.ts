// Base locale (ADR-015): the `en` modules define the message shape for every other locale.
export const app = {
  name: 'Simple IPTV',
  /** App updates (PWA-03): the snackbar shown when a new version is ready. */
  update: {
    available: 'New version available',
    action: 'Update',
  },
  /** Start-up (PWA-03 AC4): shown while the local database opens or is upgraded. */
  startup: {
    preparing: 'Preparing your data…',
  },
};
