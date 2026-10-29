// Sources (SRC-03, docs/UX_UI.md §4.2): the add-Xtream form, its connection test, problem and
// suggested-fix texts (mapped from the stable codes of the connection report), the add-M3U-by-URL
// import (SRC-05), the local M3U file import (SRC-06), and the "My lists" page, the top-bar list
// selector and the edit-list screen (SRC-08).
export const sources = {
  addXtream: {
    title: 'Add Xtream list',
    intro: 'Enter the details your provider gave you.',
    back: 'Back',
    prefilled: 'The details were filled in from your list address. Check them, then test and save.',
  },
  /** SRC-05: add an M3U list by URL. */
  addM3uUrl: {
    title: 'Add M3U list (URL)',
    intro: 'Paste the address of your M3U list. It is downloaded and read on this device only.',
    back: 'Back',
    fields: {
      url: 'List address (URL)',
      urlHelp: 'For example https://example.com/list.m3u',
      name: 'Name (optional)',
      nameHelp: 'If empty, the server name is used.',
    },
    validation: {
      urlRequired: 'Enter the list address.',
      /** By `parseExternalUrl` rejection reason. */
      url: {
        empty: 'Enter the list address.',
        invalid: 'This is not a valid address.',
        scheme: 'The address must start with http:// or https://.',
        'too-long': 'This address is too long.',
        credentials:
          'Addresses with a username and password before the server name (user:pass@…) are not supported.',
      },
    },
    submit: 'Import',
    xtreamSuggestion: {
      title: 'This URL looks like an Xtream server',
      message:
        'Use Xtream mode (recommended): it loads more details, and only your password is stored, encrypted, instead of every channel address.',
      action: 'Use Xtream mode',
    },
    steps: {
      saving: 'Saving…',
      download: 'Downloading list…',
      write: 'Saving channels…',
    },
    /** Arguments are already formatted. */
    progress: {
      downloaded: (size: string) => `${size} downloaded`,
      downloadedOf: (size: string, total: string) => `${size} of ${total} downloaded`,
      entries: (count: string) => `${count} entries read`,
    },
    result: {
      title: 'List imported',
      live: (n: string) => `Channels: ${n}`,
      movies: (n: string) => `Movies: ${n}`,
      series: (n: string) => `Series episodes: ${n}`,
      skipped: (n: string) => `${n} entries could not be used and were skipped.`,
      continue: 'Continue',
    },
    /** By import error code (providers/m3u M3uSyncErrorCode); blocked/offline/timeout reuse `problems`. */
    errors: {
      'not-m3u': {
        title: 'Not an M3U list',
        message: 'The URL did not return an M3U list.',
      },
      'empty-list': {
        title: 'No usable channels',
        message: 'The list was read, but it has no entries this app can use.',
      },
      'too-large': {
        title: 'List too large',
        message: 'This list is too large to load on this device.',
      },
      auth: {
        title: 'Access refused',
        message: 'The server refused access to the list. The address may have expired.',
      },
      'invalid-url': {
        title: 'Invalid list address',
        message: 'The saved list address is not valid. Delete this list and add it again.',
      },
      'credentials-lost': {
        title: 'List address unavailable',
        message:
          'The saved list address can no longer be read on this device. Delete this list and add it again.',
      },
      storage: {
        title: 'Could not save the channels',
        message: 'The device storage refused the data (it may be full).',
      },
    },
    /** Shown with the blocked (CORS / mixed content) messages: the local-file import (SRC-06). */
    localFile: {
      message:
        'This browser cannot download the list. Download it with another app, then add the file.',
      action: 'Add a local file',
    },
    retry: 'Try again',
    delete: 'Delete this list',
    toasts: {
      imported: 'List imported.',
      deleted: 'List deleted.',
    },
  },
  /** SRC-06: add an M3U list from a file on this device (shares `addM3uUrl` result/retry texts). */
  addM3uFile: {
    title: 'Add local M3U file',
    intro:
      'Choose an M3U or M3U8 file saved on this device. It is read on this device only, and only the channels found in it are kept.',
    back: 'Back',
    fields: {
      file: 'List file',
      choose: 'Choose file',
      change: 'Choose another file',
      none: 'No file chosen',
      /** Name and size (already formatted) of the chosen file. */
      chosen: (name: string, size: string) => `${name} (${size})`,
      fileHelp: 'An .m3u or .m3u8 file.',
      name: 'Name (optional)',
      nameHelp: 'If empty, the file name is used.',
    },
    validation: {
      fileRequired: 'Choose a file.',
    },
    submit: 'Import',
    steps: {
      saving: 'Saving…',
      read: 'Reading file…',
      write: 'Saving channels…',
    },
    /** Arguments are already formatted. */
    progress: {
      readOf: (size: string, total: string) => `${size} of ${total} read`,
    },
    /** SRC-06 AC2: files over 50 MB. `size` is already formatted. */
    largeFile: {
      title: 'Large file',
      message: (size: string) =>
        `This file is ${size}. Reading it may take several minutes and use a lot of memory, and on some devices it may not finish.`,
      confirm: 'Import anyway',
    },
    /** Error codes whose text differs from the URL import (`addM3uUrl.errors`). */
    errors: {
      'not-m3u': {
        title: 'Not an M3U list',
        message: 'The file is not an M3U list.',
      },
      'file-unreadable': {
        title: 'Could not read the file',
        message:
          'The file could not be read. It may have been moved, deleted or changed. Choose it again.',
      },
    },
  },
  fields: {
    name: 'Name (optional)',
    nameHelp: 'If empty, the server name is used.',
    server: 'Server',
    serverHelp: 'For example http://example.com:8080',
    username: 'Username',
    password: 'Password',
    showPassword: 'Show password',
  },
  validation: {
    serverRequired: 'Enter the server address.',
    usernameRequired: 'Enter the username.',
    passwordRequired: 'Enter the password.',
    /** By `normalizeServerUrl` rejection reason. */
    serverUrl: {
      empty: 'Enter the server address.',
      invalid: 'This is not a valid server address.',
      scheme: 'The address must start with http:// or https://.',
      'too-long': 'This address is too long.',
      credentials:
        'Do not put the username or password in the address: use the fields below instead.',
    },
  },
  submit: 'Test and save',
  steps: {
    contacting: 'Contacting server…',
    validating: 'Validating account…',
    saving: 'Saving…',
  },
  result: {
    title: 'Connected',
    status: (status: string) => `Account status: ${status}`,
    expires: (date: string) => `Valid until ${date}`,
    noExpiry: 'No expiry date',
    connections: (active: string, max: string) => `Connections in use: ${active} of ${max}`,
    maxConnections: (max: string) => `Allowed connections: ${max}`,
    warningsTitle: 'Things to know',
    continue: 'Go to Home',
  },
  fixesTitle: 'What you can do',
  saveAnyway: 'Save anyway',
  saveAnywayHint:
    'You can save the list now, but channels will not load from this page until the problem is solved.',
  toasts: {
    saved: 'List saved.',
    syncing: 'Loading your channels…',
    savedWithError: 'List saved. Channels will load once the connection problem is solved.',
  },
  /** By connection problem code (providers/xtream ConnectionProblemCode). */
  problems: {
    'auth-failed': {
      title: 'Sign-in rejected',
      message: 'The server rejected the username or password.',
    },
    'account-expired': { title: 'Account expired', message: 'This subscription has expired.' },
    'account-banned': {
      title: 'Account blocked',
      message: 'The provider has blocked this account.',
    },
    'account-disabled': {
      title: 'Account disabled',
      message: 'The provider has disabled this account.',
    },
    'account-inactive': { title: 'Account not active', message: 'This account is not active.' },
    'max-connections-reached': {
      title: 'All connections in use',
      message:
        'Every connection your subscription allows is in use. Playback may fail until one is free.',
    },
    offline: { title: 'You are offline', message: 'There is no network connection.' },
    timeout: {
      title: 'The server took too long',
      message: 'The server did not respond in time.',
    },
    'blocked-mixed-content': {
      title: 'Insecure server address',
      message:
        'This server uses HTTP, which browsers block on a secure (HTTPS) page, and no HTTPS address answered.',
    },
    'blocked-cors': {
      title: 'Server does not allow web apps',
      message:
        'The browser blocked the request: the server does not allow web apps (CORS), or it could not be reached.',
    },
    'network-error': {
      title: 'Server not reachable',
      message: 'The request did not complete.',
    },
    'http-error': {
      title: 'Unexpected server response',
      message: 'The server returned an unexpected response.',
    },
    'invalid-response': {
      title: 'Not an Xtream server',
      message: 'The server did not answer like an Xtream Codes panel.',
    },
    'http-only': {
      title: 'HTTP-only server',
      message: 'This server only works over HTTP. Channels may not play in the browser.',
    },
    'https-unavailable': {
      title: 'HTTPS not working',
      message: 'The server reports an HTTPS port, but HTTPS did not work. HTTP is used instead.',
    },
  },
  /** By suggested fix code (providers/xtream ConnectionFixCode). */
  fixes: {
    'check-credentials': 'Check the username and password (they are case-sensitive).',
    'renew-subscription': 'Renew your subscription with your provider.',
    'contact-provider': 'Contact your provider.',
    'close-other-players': 'Close the app on other devices, then try again.',
    'check-network': 'Check your network connection.',
    'retry-later': 'Try again in a few minutes.',
    'check-server-url': 'Check the server address, including the port.',
    'see-connection-options': 'Ask your provider whether the server has an HTTPS address.',
    'use-https': 'Use the HTTPS address of your server, if your provider offers one.',
    'use-local-file': 'Download the M3U list and add it as a local file.',
    'use-proxy': 'Use a proxy that serves this server over HTTPS.',
  },
  /** SRC-08: the "My lists" page (docs/UX_UI.md §4.1b). */
  myLists: {
    title: 'My lists',
    add: 'Add list',
    loadError: {
      title: 'Could not load your lists',
      message: 'Your lists could not be read from this device.',
    },
    empty: {
      title: "You don't have any IPTV lists yet",
      message: 'Add an Xtream or M3U list to start watching.',
    },
    active: 'Active',
    kinds: { xtream: 'Xtream', 'm3u-url': 'M3U (URL)', 'm3u-file': 'M3U (file)' },
    /** `count` selects the plural form; `formatted` is the localized number. */
    counts: {
      channels: (count: number, formatted: string) =>
        count === 1 ? '1 channel' : `${formatted} channels`,
      movies: (count: number, formatted: string) =>
        count === 1 ? '1 movie' : `${formatted} movies`,
      series: (_count: number, formatted: string) => `${formatted} series`,
    },
    /** `when` is a relative time already formatted (e.g. "2 hours ago"). */
    updated: (when: string) => `Updated ${when}`,
    neverUpdated: 'Never updated',
    /** Content types named in a partial-update status. */
    contentTypes: { live: 'channels', movie: 'movies', series: 'series' },
    status: {
      never: 'Not loaded yet',
      syncing: 'Updating…',
      ok: 'Up to date',
      /** `types` is a localized list (e.g. "movies and series"). */
      partial: (types: string, reason: string) =>
        `Some content was not updated (${types}): ${reason}`,
      error: (reason: string) => `Update failed: ${reason}`,
    },
    /** Short reasons by sync error code (the providers' stable codes, never sensitive). */
    reasons: {
      offline: 'no network connection',
      timeout: 'the server took too long',
      blocked: 'the browser blocked the server',
      'blocked-mixed-content': 'insecure (HTTP) server address',
      http: 'unexpected server response',
      auth: 'access refused',
      parse: 'unreadable server response',
      'account-inactive': 'the account is not active',
      'invalid-response': 'the server did not answer as expected',
      'empty-response': 'the server returned an empty list',
      'server-unreachable': 'server not reachable',
      storage: 'device storage is full or unavailable',
      'credentials-lost': 'the saved credentials can no longer be read — edit the list',
      'not-m3u': 'not an M3U list',
      'empty-list': 'the list has no usable entries',
      'too-large': 'the list is too large',
      'invalid-url': 'invalid list address',
      'file-unreadable': 'the file could not be read — refresh it with the file',
      unknown: 'unknown error',
    },
    actions: {
      use: 'Use this',
      refresh: 'Refresh',
      edit: 'Edit',
      remove: 'Remove',
    },
    /** Sync progress phases (Xtream and M3U). */
    phases: {
      starting: 'Starting update…',
      auth: 'Signing in…',
      'live-categories': 'Loading channel categories…',
      live: 'Loading channels…',
      'movie-categories': 'Loading movie categories…',
      movie: 'Loading movies…',
      'series-categories': 'Loading series categories…',
      series: 'Loading series…',
      download: 'Downloading list…',
      read: 'Reading file…',
      parse: 'Reading list…',
      write: 'Saving channels…',
      done: 'Finishing…',
    },
    toasts: {
      switched: (name: string) => `Now using “${name}”.`,
      removed: (name: string) => `“${name}” removed.`,
      removeFailed: (name: string) => `Could not remove “${name}”.`,
      refreshed: (name: string) => `“${name}” updated.`,
      refreshPartial: (name: string) => `“${name}” was only partly updated.`,
      refreshFailed: (name: string) => `Could not update “${name}”.`,
      refreshUnavailable: 'The update could not be started.',
      updated: 'List updated.',
    },
    /** SRC-06 AC3: a list from a file has no address, so "Refresh" asks for the file again. */
    refreshFile: {
      title: (name: string) => `Refresh “${name}”`,
      message:
        'This list was added from a file, so it cannot be downloaded again. Choose the updated file to refresh it. Favorites and history are kept.',
      choose: 'Choose file',
    },
    remove: {
      title: (name: string) => `Remove “${name}”?`,
      message:
        'Its channels, movies, series, favorites and history are deleted from this device. Your subscription is not affected.',
      confirm: 'Remove',
    },
  },
  /** SRC-08: edit a list (rename; Xtream server and credentials). */
  edit: {
    title: 'Edit list',
    back: 'Back',
    notFound: {
      title: 'List not found',
      message: 'This list no longer exists on this device.',
    },
    loadError: { title: 'Could not load this list', message: 'Try again in a moment.' },
    name: 'Name',
    nameHelp: 'If empty, the server name is used.',
    passwordKeepHelp: 'Leave empty to keep the current password.',
    passwordLost: 'The saved password can no longer be read on this device. Enter it again.',
    save: 'Save',
    saveAndTest: 'Test and save',
  },
};
