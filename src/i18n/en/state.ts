// State and feedback components (UX-02, docs/UX_UI.md §5): loading, progress, toasts and the
// error descriptions produced by `describeError` (src/ui/state/describeError.ts).
export const state = {
  loading: 'Loading…',
  details: 'Details',
  cancel: 'Cancel',
  cancelling: 'Cancelling…',
  dismiss: 'Close',
  /** Persistent connection banner (PWA-04). Never promises offline playback. */
  connection: {
    offline: 'No connection. You can browse your lists, but not play, refresh or add lists.',
    unreachable: 'The network is not responding. Check your connection.',
    retry: 'Try again',
  },
  progress: {
    /** Count of processed items when the total is unknown. Arguments are already formatted. */
    count: (count: string) => `${count} processed`,
    countOf: (count: string, total: string) => `${count} of ${total}`,
  },
  /** Labels of the suggested actions returned by `describeError`. */
  actions: {
    retry: 'Try again',
    reload: 'Reload',
    'edit-source': 'Edit list',
    'reenter-credentials': 'Re-enter password',
  },
  errors: {
    /** Neutral: a cancelled request or task is not a failure. */
    cancelled: { title: 'Cancelled', message: 'The operation was cancelled.' },
    net: {
      offline: {
        title: 'You are offline',
        message: 'No network connection. Check your connection and try again.',
      },
      timeout: {
        title: 'The server took too long',
        message: 'The server did not respond in time. Try again in a moment.',
      },
      blocked: {
        title: 'Request blocked by the browser',
        message:
          'The browser did not allow the request to this server. Check the address or try again.',
      },
      blockedCors: {
        title: 'Server does not allow web apps',
        message:
          'This server does not allow access from web apps (CORS). Download the list and import the file instead, or use another server address.',
      },
      blockedMixedContent: {
        title: 'Insecure server address',
        message:
          'This server uses HTTP, which browsers block on a secure (HTTPS) page. Use an HTTPS address if the server offers one.',
      },
      http: {
        title: 'Unexpected server response',
        message: 'The server returned an unexpected response. Try again later.',
      },
      httpStatus: (status: string) =>
        `The server returned an unexpected response (HTTP ${status}). Try again later.`,
      auth: {
        title: 'Sign-in rejected',
        message: 'The server rejected the username or password. Check them and try again.',
      },
      parse: {
        title: 'Response could not be read',
        message:
          'The server answered with something the app does not understand. Check the address and try again.',
      },
    },
    worker: {
      failed: {
        title: 'Processing failed',
        message: 'The data could not be processed. Try again.',
      },
    },
    /** The message comes from `db.errors[reason]`. */
    db: { title: 'Storage unavailable' },
    vault: {
      'missing-key': {
        title: 'Saved password unavailable',
        message:
          'The key that protects your saved password is gone (browser data may have been cleared). Enter the password again.',
      },
      'decrypt-failed': {
        title: 'Saved password unreadable',
        message: 'Your saved password could not be decrypted. Enter the password again.',
      },
    },
    unknown: {
      title: 'Something went wrong',
      message: 'An unexpected error occurred. Try again.',
    },
  },
};
