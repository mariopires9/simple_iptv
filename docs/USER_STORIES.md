# User stories

Status of each story: see **`BACKLOG.md`** (single source of truth for statuses). This file holds the content; do not edit statuses here.

## Conventions
- **Priority:** `Must` (MVP) · `Should` (v1.1) · `Could` (experimental/later).
- **Effort:** relative points 1 · 2 · 3 · 5 · 8 (8 = maximum; larger → split).
- **Value:** High / Medium / Low for the end user.
- **AC:** acceptance criteria in Given/When/Then.

### Definition of Ready (DoR) — to move to `Ready`
Dependencies `Done`; verifiable AC; expected files/areas listed; questions resolved or assumptions recorded.

### Definition of Done (DoD) — applies to every story
1. All AC met and demonstrated by automated tests (or, if impossible, manual verification recorded in `docs/progress/`).
2. `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` without errors.
3. No `console.log` with sensitive data; the redacting logger is used.
4. UI strings in `src/i18n/en/<feature>.ts` with the pt-PT translation in `src/i18n/pt-PT/<feature>.ts` (ADR-015).
5. Independent review (`/code-review`) for stories ≥ 3 points or that touch `core/`, `player/`, security or shared files; findings fixed or justified.
6. Accessibility: new components have an accessible name and visible focus; E2E with axe when the story has UI.
7. `BACKLOG.md` updated; ADR created if an architectural decision was made.
8. Initial bundle does not exceed the budget (once QA-03 exists).

---

## Spike

### S-00 — Validate compatibility of the real IPTV provider
- **Epic:** E0 · **Priority:** Must · **Effort:** 3 · **Value:** High (decides ADR-010)
- **Story:** As the product owner, I want to know whether my provider works from an HTTPS page in the browser, so that I can decide whether the MVP needs a proxy or a native shell.
- **AC:**
  1. Given real credentials supplied by the user at runtime (never in a file), When the spike page served from `https://localhost`/test Pages is run, Then the report states: HTTPS available (yes/no, port), CORS on `player_api.php` (yes/no), allowed formats (`allowed_output_formats`), stream redirects (target host and scheme).
  2. Given a test channel, When playback is attempted as `.ts` (mpegts.js) and `.m3u8` (hls.js and native), Then success/failure is recorded per browser (Chrome desktop, Chrome Android, Safari iOS if available) along with detected codecs.
  3. Given the results, Then ADR-010 moves to `Accepted` with the chosen option, and the backlog is adjusted (PRX-01/NAT-01 move up to Must if needed).
- **Dependencies:** none (can run in parallel with FND-01).
- **Tasks:** isolated HTML page in `spikes/compat/` (throwaway, outside `src/`); manual tests; report `docs/progress/S-00-report.md` **without credentials or the full host** (host masked).
- **Tests:** manual, recorded.
- **Risks:** the user may not have an iOS device; results depend on time of day/server.
- **Specific DoD:** report + ADR-010 updated; spike code does not enter the app build.

---

## E0 — Foundations

### FND-01 — Project scaffold
- **Priority:** Must · **Effort:** 3 · **Value:** Medium (enabler)
- **Story:** As a developer, I want a Vite + React + TS project with lint, formatting and tests configured, so that every story starts from a consistent base.
- **AC:**
  1. Given a clean clone, When `npm ci && npm run dev`, Then the app opens on `localhost` with a placeholder screen.
  2. Given the project, When `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, Then all pass.
  3. Given `tsconfig`, Then `strict: true`, `noUncheckedIndexedAccess: true`.
  4. Given the folder structure in `ARCHITECTURE.md §2`, Then it exists with a minimal `README` or `index.ts` per module.
  5. Given boundary rules, When a file in `core/` imports from `features/`, Then lint fails.
- **Dependencies:** — (requires authorized `git init`).
- **Tasks:** `git init`, `.gitignore`, `package.json` scripts, ESLint flat config (typescript-eslint, react-hooks, jsx-a11y, import boundaries), Prettier, Vitest + jsdom + Testing Library, `.nvmrc` (Node 24), `.editorconfig`, `CLAUDE.md` updated with the real commands, `.claude/agents/*` (see `AGENT_WORKFLOW.md`).
- **Tests:** trivial render test; boundary lint test (fixture file).
- **Risks:** recent major versions (Vite 8, React 19.3, Vitest 5) with misaligned plugins → pin compatible versions.

### FND-02 — CI pipeline
- **Priority:** Must · **Effort:** 2 · **Value:** Medium
- **Story:** As a maintainer, I want every push and PR to run lint, typecheck, tests, build and audit, so that regressions are caught early.
- **AC:**
  1. Given a PR, When the workflow runs, Then it executes `lint`, `typecheck`, `test --coverage`, `build`, `npm audit --audit-level=high` and a license check (allowlist: MIT, ISC, BSD-2/3, Apache-2.0, OFL-1.1, 0BSD, CC0).
  2. Given a dependency with a license outside the allowlist, Then the job fails naming the package.
  3. Given Dependabot/Renovate, Then it is configured weekly for npm and GitHub Actions (with actions pinned by SHA).
- **Dependencies:** FND-01.
- **Tasks:** `.github/workflows/ci.yml`, `license-checker-rseidelsohn` or a custom script, `dependabot.yml`.
- **Tests:** workflow run on a test PR.
- **Risks:** requires a GitHub repository (user decision D-2).

### FND-03 — Design tokens, theme and AppShell
- **Priority:** Must · **Effort:** 5 · **Value:** High
- **Story:** As a user, I want a consistent interface in dark and light themes, adapted to my screen, so that I can navigate comfortably.
- **AC:**
  1. Given the tokens in `UX_UI.md §2`, When the MUI theme is created, Then every component uses tokens (no literal colors outside `ui/theme`).
  2. Given the defined text/background pairs, When the contrast test runs, Then all meet ≥ 4.5:1 (text) and ≥ 3:1 (UI); otherwise the tokens are adjusted and documented.
  3. Given width < 600 px, Then a bottom bar appears; 600–1199 px a rail; ≥ 1200 px an expanded rail.
  4. Given the "System/Dark/Light" preference, When it changes, Then the theme switches without reload and persists.
  5. Given `prefers-reduced-motion`, Then transitions are disabled.
- **Dependencies:** FND-01.
- **Tasks:** `ui/theme/tokens.ts`, `createTheme`, `CssBaseline`, self-hosted Inter font, `AppShell` with `BottomNav`/`NavRail`, `TopBar`, ripple off.
- **Tests:** contrast unit test (WCAG calculation over tokens); AppShell component in 3 viewports (Playwright, after QA-02) or render tests with a `matchMedia` mock.
- **Risks:** MUI weight — measure the bundle at the end of the story (feeds ADR-003).

### FND-04 — Routing and screen skeleton
- **Priority:** Must · **Effort:** 2 · **Value:** Medium
- **Story:** As a user, I want to navigate between Home, Live, Movies, Series, Favorites, Search and Settings, and have deep links work, so that I quickly get where I want.
- **AC:**
  1. Given the hash router, When I open `/#/movies/category/123` directly, Then the correct route is shown (no 404 on GitHub Pages).
  2. Given each route, Then it is loaded with `lazy()` (own chunk).
  3. Given an unknown route, Then a "Page not found" screen is shown with a link to Home.
  4. Given the Android/browser "back" button, Then it returns to the previous screen (does not close the app from the player).
- **Dependencies:** FND-03.
- **Tasks:** `app/router.tsx`, per-route `ErrorBoundary`, placeholders.
- **Tests:** route unit tests (memory router); deep-link E2E.

### FND-05 — Persistence layer (Dexie)
- **Priority:** Must · **Effort:** 5 · **Value:** High (enabler)
- **Story:** As a user, I want my sources, favorites and progress saved on the device, so that I don't have to set them up again.
- **AC:**
  1. Given the schema in `ARCHITECTURE.md §5`, When the app starts, Then the `simple-iptv` v1 database is created.
  2. Given typed repositories (`sourcesRepo`, `catalogRepo`, `favoritesRepo`, `historyRepo`, `settingsRepo`), Then no feature uses `db.table()` directly.
  3. Given 100,000 items, When `catalogRepo.replaceForSource(sourceId, type, items)`, Then it completes in a single transaction and the old items for that source+type are removed.
  4. Given removal of a source, Then every record with that `sourceId` is deleted (catalog, favorites, history, index, secret).
  5. Given IndexedDB unavailable (e.g. restricted private mode), Then the app shows a clear error and does not stay blank.
- **Dependencies:** FND-01.
- **Tasks:** `core/db/schema.ts`, `repos/*`, `wipeAll()`, compound-key helpers.
- **Tests:** unit with `fake-indexeddb`; bulkPut performance test (tagged `@slow`).
- **Risks:** quota limits on iOS; future migrations.

### FND-06 — Redacting logger and error model
- **Priority:** Must · **Effort:** 2 · **Value:** Medium (security)
- **Story:** As a user, I want my credentials never to appear in logs or error messages, so that I don't expose them when sharing a problem.
- **AC:**
  1. Given a string with `password=abc`, `username=joao`, `/live/joao/abc/1.ts` or a registered secret, When it is logged, Then it comes out as `password=***`, `/live/***/***/1.ts`.
  2. Given a `NetError`, Then it contains `kind` and never the full unredacted URL.
  3. Given the log buffer, When the user exports the "Diagnostics report", Then the file goes through the same filters.
- **Dependencies:** FND-01.
- **Tasks:** `core/log`, `core/net/errors.ts`, `redact()` function.
- **Tests:** unit with cases for Xtream URLs, M3U `get.php`, query strings, URL-encoded, base64.

### FND-07 — Web Worker infrastructure
- **Priority:** Must · **Effort:** 2 · **Value:** Medium (performance)
- **Story:** As a user, I want the app to stay smooth while large lists load, so that the screen doesn't freeze.
- **AC:**
  1. Given the data worker, When called via Comlink, Then it supports progress (callback) and cancellation (`AbortSignal` → flag).
  2. Given an error in the worker, Then it is propagated as a serialized `Error` with `kind`, without sensitive data.
  3. Given a production build, Then the worker is a separate chunk.
- **Dependencies:** FND-01.
- **Tests:** API unit tests (with a simulated worker); E2E measures absence of long tasks during a synthetic task.

---

## E1 — IPTV sources

### SRC-01 — Credential vault
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want the password of my IPTV service encrypted on the device, so that the risk of exposure is reduced if someone copies the app data.
- **AC:**
  1. Given first use, When the vault is initialized, Then it generates a **non-extractable** AES-GCM 256 key and stores it in IndexedDB.
  2. Given `put(ref, secret)`, Then the `secrets` table contains only `iv` + `ciphertext` (verified by a test that reads the raw table).
  3. Given `get(ref)`, Then it returns the original secret; unique IV per encryption.
  4. Given `wipe()`, Then the key and secrets are deleted.
  5. Given the "Privacy" page, Then it explains in plain language what this protection covers and does not cover (ADR-006).
- **Dependencies:** FND-05, FND-06.
- **Tests:** unit (WebCrypto in Node 24 / jsdom), non-extractability test.
- **Risks:** loss of the key (e.g. partial clearing by the browser) → unreadable secrets → "Re-enter password" flow.

### SRC-02 — Xtream client: authentication and account
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want to know right away whether my provider details are correct and the state of my account, so that I don't waste time on wrong settings.
- **AC:**
  1. Given a server entered as `example.com:8080`, `http://example.com:8080/`, or with `/player_api.php`, Then it is normalized to `scheme://host:port`.
  2. Given valid credentials, When `testConnection()`, Then it returns `account` (status, expiry, connections, formats).
  3. Given `user_info.auth = 0` or 401/403, Then `NetError(kind='auth')` → message "Incorrect username or password".
  4. Given `status` ≠ `Active` (Expired, Banned, Disabled), Then a specific message.
  5. Given a fetch `TypeError` with an HTTPS page and an `http:` server, Then `kind='blocked', hint='mixed-content'`; with an `https:` server, `hint='cors'`.
  6. Given an `http:` server and `server_info.https_port` present, Then it automatically tries `https://host:https_port` and reports the result.
  7. Given a timeout (15 s), Then `kind='timeout'`.
- **Dependencies:** FND-06.
- **Tasks:** `providers/xtream/client.ts`, `schemas.ts` (Valibot), `normalizeServerUrl`.
- **Tests:** unit with MSW and fixtures (`fixtures/xtream/*.json`) including panel variants, numbers as strings, null fields.

### SRC-03 — Add Xtream source (UI)
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want to enter server, username and password in a simple form and test the connection, so that I can start watching TV.
- **AC:**
  1. Given empty fields or an invalid URL, When I submit, Then I see per-field errors, with focus on the first error.
  2. Given valid data, When "Test and save", Then I see the test steps and, on success, the source is saved (password in the vault) and sync starts (SRC-07).
  3. Given a failure, Then the message comes from the error map with a suggested action and the form data is kept.
  4. Given the password field, Then it has `autocomplete="current-password"` and a show/hide button with `aria-pressed`.
  5. Given an HTTP-only warning, Then the user can save anyway, after seeing the warning.
- **Dependencies:** SRC-01, SRC-02, FND-04, UX-02.
- **Tests:** component (Testing Library) + E2E with MSW.

### SRC-04 — Streaming M3U/M3U8 parser
- **Priority:** Must · **Effort:** 5 · **Value:** High
- **Story:** As a user with an M3U list, I want the list read correctly, including logos and groups, so that I see the channels organized.
- **AC:**
  1. Given `#EXTINF` with `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, `tvg-chno`, `catchup*`, Then all attributes are extracted (single/double quotes, spaces, commas in the name).
  2. Given a `#EXTM3U url-tvg="..."` or `x-tvg-url` header, Then the EPG URL(s) are captured — the value may hold several comma-separated URLs (seen in real lists).
  3. Given `#EXTVLCOPT`/`#KODIPROP`/`#EXTGRP` lines, Then they are attached to the next entry (EXTGRP as the group if there is no group-title) or ignored without error.
  4. Given a UTF-8 BOM, CRLF, empty lines, entries without `#EXTINF`, Then the parser is tolerant. Lists without the `#EXTM3U` header are accepted when they start with `#EXTINF` entries (common in real lists); HTML/JSON/empty bodies are rejected.
  5. Given entries with a `javascript:`, `data:`, `file:` or invalid URL, Then they are discarded and counted as "skipped".
  6. Given a text stream of 50,000 entries, Then it processes in chunks, emits progress and does not hold the whole file twice in memory.
  7. Given entries, Then each is classified `live|movie|series` (VOD-04 heuristic — initially everything `live` except URLs with `/movie/` or `/series/`).
  9. Given entries without `group-title`/`#EXTGRP`, Then they are assigned to a synthetic per-source category "Uncategorized" (stable key), so every catalog item has a `categoryKey` (LIV-01 pages "All" per category).
  8. Given playback requirements the browser cannot honour, Then they are recorded on the entry instead of being dropped: `#KODIPROP:inputstream.adaptive.license_*` → `drm: true`; `#EXTVLCOPT:http-user-agent|http-referrer|http-origin` → `requiredHeaders: [...]`; `.mpd` URLs → container `dash`; `radio="true"` → `audioOnly: true`. (Real list M3UPT, 2026-10-28: 60 DRM entries, 66 DASH, 78/57/33 entries needing UA/Referer/Origin, 85 radios out of 929.)
- **Dependencies:** FND-07.
- **Tests:** unit with synthetic fixtures (valid, malformed, huge generated ones), property-based (fast-check) for robustness; benchmark.

### SRC-05 — Import M3U by URL
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want to paste the URL of my M3U list, so that I can import the channels without downloading files.
- **AC:**
  1. Given an `http(s)://` URL, When I import, Then it is downloaded as a stream in the worker with progress (bytes and entries).
  2. Given a URL of the form `get.php?username=…&password=…`, Then the app suggests "This URL looks like an Xtream server — use Xtream mode (recommended)" and pre-fills the Xtream form.
  3. Given CORS/mixed content blocked, Then an actionable message suggests downloading the file and using local import (SRC-06).
  4. Given a response that does not start with `#EXTM3U` (e.g. an HTML error page), Then the error "The URL did not return an M3U list".
  5. Given the URL, Then it is stored in the vault (it often contains credentials).
- **Dependencies:** SRC-04, SRC-01, FND-05.
- **Tests:** unit/integration with MSW; E2E.

### SRC-06 — Import local M3U file
- **Priority:** Must · **Effort:** 2 · **Value:** Medium
- **Story:** As a user, I want to pick a `.m3u`/`.m3u8` file from my device, so that I can use lists that are not online or whose server blocks the browser.
- **AC:**
  1. Given the file picker (`accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl"`), When I choose a file, Then it is read via `file.stream()` in the worker.
  2. Given a file > 50 MB, Then a time warning and confirmation.
  3. Given a file-type source, Then "Refresh" asks for a new file (there is no URL).
- **Dependencies:** SRC-04, FND-05.
- **Tests:** component + E2E with `setInputFiles`.

### SRC-07 — Sync Xtream catalog
- **Priority:** Must · **Effort:** 5 · **Value:** High
- **Story:** As a user, I want my provider's channels, movies and series loaded and saved, so that I can browse quickly even with thousands of items.
- **AC:**
  1. Given an Xtream source, When it syncs, Then it fetches live, movie and series categories and items in the worker and writes them via `replaceForSource` (flow in `ARCHITECTURE.md §6.1`).
  2. Given responses with invalid items, Then those items are skipped and counted; the rest is written.
  3. Given a re-sync, Then favorites and history are kept (stable keys by `stream_id`/`series_id`).
  4. Given cancellation, Then previous data remains intact (one transaction per type).
  5. Given `lastSyncAt` > 24 h when opening the app with network, Then a background sync with a discreet indicator.
  6. Given a failure in one type (e.g. series 500), Then the other types remain available and the error is shown on the source.
- **Dependencies:** SRC-02, FND-05, FND-07.
- **Tests:** integration with MSW + fake-indexeddb; large generated fixture (50k VOD).
- **Risks:** JSON of tens of MB → memory on weak devices (measure; plan B: load per category).

### SRC-08 — "My lists" page
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want a page with all my saved IPTV lists, where I can view, edit, refresh, remove them and choose which one to use, so that I can manage several subscriptions or lists.
- **AC:**
  0. Given the "My lists" page (`UX_UI.md §4.1b`), Then it is reachable from the list selector in the top bar ("Manage lists…"), from Settings and from the rail on desktop; there is no artificial limit on the number of lists.
  1. Given the page, Then each list shows name, type (Xtream / M3U URL / M3U file), counts, last sync, status, an "ACTIVE" indication and (Xtream) account expiry.
  2. Given "Edit", When I change credentials and save, Then the connection is tested before applying.
  3. Given "Remove", When I confirm in a dialog, Then the source and all associated data are deleted (FND-05 AC4).
  4. Given several sources, When I choose another in the top-bar selector, Then every screen uses the active source in < 300 ms (no network).
  5. Given "Refresh", Then it syncs (SRC-07/SRC-05) with progress.
- **Dependencies:** SRC-03, SRC-05, SRC-07.
- **Tests:** component + E2E.

### SRC-09 — Compatibility diagnostics
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want to understand why a source does not work in the browser and what I can do, so that I know whether the problem is mine, the provider's or the browser's.
- **AC:**
  1. Given a source, When I open "Diagnostics", Then I see a checklist: HTTPS, API access (CORS), live format (TS/HLS), browser support (MSE/MMS, native HLS), tested codecs (`isTypeSupported` H.264/HEVC/AAC/AC-3).
  2. Given each failure, Then there is an explanation and possible actions (use HTTPS if the provider has it, local file, Safari, personal proxy when it exists).
  3. Given "Copy report", Then the text contains neither credentials nor the full host (masked).
- **Dependencies:** SRC-02, PLY-01.
- **Tests:** unit tests of the checkers; snapshot of the redacted report.

### SRC-10 — Delete all local data
- **Priority:** Must · **Effort:** 2 · **Value:** High (privacy)
- **Story:** As a user, I want to delete all the app's data with one action, so that I can sell/lend the device or start over.
- **AC:**
  1. Given Settings › Privacy › "Delete all data", When I confirm by typing the localized confirmation word (`DELETE` in English, `APAGAR` in pt-PT), Then IndexedDB, Cache Storage and preferences are removed and the app returns to onboarding.
  2. Given the operation, Then the service worker remains (the app stays installed) but without data.
  3. Given a partial failure, Then the app reports it and offers to retry.
- **Dependencies:** FND-05, SRC-01, PWA-02.
- **Tests:** E2E checks `indexedDB.databases()` is empty and `caches.keys()` has no data caches.

---

## E3 — Player

### PLY-01 — Playback engine and engine selection
- **Priority:** Must · **Effort:** 5 · **Value:** High
- **Story:** As a user, I want the app to automatically choose the best way to play each stream, so that I don't have to understand formats.
- **AC:**
  1. Given `StreamDescriptor` and `Capabilities`, When `selectEngine`, Then it follows the table in `RESEARCH.md §5.2` (testable with a case matrix).
  2. Given hls.js/mpegts.js, Then they are only downloaded on first use (separate chunks; verified in the build).
  3. Given a stream change, Then the previous engine is destroyed (no leaks: listeners, `MediaSource`, `ObjectURL` revoked).
  4. Given a failure with `fallbacks`, Then it tries the next descriptor once before reporting an error.
  5. Given `UrlRewriter`, Then every URL goes through it (identity in the MVP).
- **Dependencies:** FND-01, FND-06.
- **Tasks:** `player/engines/*`, `player/select.ts`, `core/platform/capabilities.ts`.
- **Tests:** matrix unit tests; integration in Playwright (Chromium + WebKit) with local test streams (QA-01).
- **Risks:** MMS vs MSE differences on iOS (validate in S-00/DEP-02).

### PLY-02 — Player UI and controls
- **Priority:** Must · **Effort:** 5 · **Value:** High
- **Story:** As a user, I want clear controls (play/pause, volume, progress, live), so that I can easily control playback on any device.
- **AC:**
  1. Given a live stream, Then a "Live" indicator is shown and no seek bar (unless `seekable` > 30 s — DVR).
  2. Given VOD, Then a progress bar with current/total time, seek by click/tap/keys ±10 s.
  3. Given 3 s of inactivity while playing, Then controls hide; they reappear on touch/mouse/key.
  4. Given the shortcuts in `UX_UI.md §4.5`, Then they work when the player has focus and do not interfere with text fields.
  5. Given a buffering state, Then a spinner after 500 ms (no flash).
  6. Given a screen reader, Then every button has an `aria-label` and state changes are announced.
- **Dependencies:** PLY-01, FND-03.
- **Tests:** component with an `HTMLMediaElement` mock; E2E with a test stream; axe.

### PLY-03 — Fullscreen, orientation and Picture-in-Picture
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want to watch in fullscreen and in PiP, so that I can make the most of the screen or keep watching while doing something else.
- **AC:**
  1. Given the Fullscreen API available, Then the player container (with its own overlay) enters fullscreen.
  2. Given iPhone (no Fullscreen API on elements), Then it uses `video.webkitEnterFullscreen()` and the UI states that the controls are the system's.
  3. Given mobile in landscape during playback and the option enabled, Then it enters fullscreen; `screen.orientation.lock` is used only where supported, with no errors where it is not. Note (2026-10-29): browsers refuse fullscreen requests without a user gesture, so rotation shows a large "Tap for fullscreen" prompt instead of entering automatically.
  4. Given PiP supported (`document.pictureInPictureEnabled` or `webkitSetPresentationMode`), Then the PiP button is visible; otherwise hidden.
- **Dependencies:** PLY-02.
- **Tests:** unit with mocked feature detection; manual on devices (DEP-02).

### PLY-04 — Playback errors and recovery
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want to understand why a channel does not open and easily try again, so that I'm not left staring at a black screen.
- **AC:**
  1. Given a transient network error on live, Then up to 3 retries with backoff (1 s, 2 s, 4 s) before showing an error.
  2. Given `MEDIA_ERR_SRC_NOT_SUPPORTED`/`bufferAddCodecError`/`isTypeSupported=false`, Then the message "format/codec not supported" with the codec when known.
  3. Given video playing but an unsupported audio track, Then the warning "no sound: audio X not supported in this browser".
  4. Given 401/403/`max_connections` reached (when detectable), Then an account/connections message.
  5. Given `blocked`, Then an HTTPS/CORS message with a link to diagnostics (SRC-09).
  6. Given the error screen, Then "Try again" and (live) "Next channel".
  7. Given an entry flagged `drm` or container `dash` (SRC-04 AC8), Then the player does not attempt playback and shows "This channel uses DRM / DASH, which this app does not support" (no DRM circumvention — SECURITY.md §8).
  8. Given an entry with `requiredHeaders` that fails with 401/403, Then the message explains the provider restricts playback to its own site/app (browsers cannot send custom Referer/User-Agent).
- **Dependencies:** PLY-01, FND-06.
- **Tests:** unit tests of the error→message mapping; integration with corrupted/invalid-codec test streams.

### PLY-05 — Audio tracks and subtitles
- **Priority:** Should · **Effort:** 3 · **Value:** Medium
- **Story:** As a user, I want to choose the audio and subtitle language when the content has them, so that I watch in my preferred language.
- **AC:**
  1. Given hls.js with multiple tracks, Then the menu lists them with language/name and allows switching without restarting.
  2. Given native with `audioTracks`/`textTracks` (Safari), Then the same.
  3. Given no alternative tracks, Then the menu does not appear.
  4. Given a saved language preference, Then it is applied automatically when available.
- **Dependencies:** PLY-02.
- **Tests:** HLS test stream with multiple tracks.

---

## E4 — Live TV

### LIV-01 — Categories and channel list
- **Priority:** Must · **Effort:** 5 · **Value:** High
- **Story:** As a user, I want to see channels organized by category, with logos, so that I quickly find what I want to watch.
- **AC:**
  1. Given the active source, Then the category list includes "Favorites", "Recent", "All" + the source's categories in their original order.
  2. Given 20,000 channels in "All", Then the list is virtualized and meets NFR-03.
  3. Given an unavailable or failed logo (incl. mixed content), Then initials are shown with a color derived from the name.
  4. Given keyboard navigation, Then arrows move the selection, `Enter` plays, `F`/`★` toggles favorite.
  5. Given an empty category, Then an empty state.
- **Dependencies:** FND-05, FND-04, UX-02, SRC-07 or SRC-05 (data).
- **Tests:** component with 20k synthetic items; performance E2E (Playwright trace).

### LIV-02 — Play channel and zapping
- **Priority:** Must · **Effort:** 5 · **Value:** High
- **Story:** As a user, I want to tap a channel and quickly switch to the previous/next one, so that I can zap like on a TV.
- **AC:**
  1. Given a tapped channel, Then the player opens (mobile: top; desktop: panel) and playback starts.
  2. Given `↑/↓`, the ⏮/⏭ buttons or a vertical swipe in fullscreen, Then it switches to the previous/next channel **within the current category**, with the name shown immediately.
  3. Given rapid changes (5 in 2 s), Then only the last channel loads (previous requests aborted).
  4. Given the "Channels" panel in fullscreen, Then a channel can be chosen without leaving fullscreen.
  5. Given a channel change, Then it is recorded in "Recent" (FAV-02).
- **Dependencies:** LIV-01, PLY-02.
- **Tests:** E2E with 3 test streams; unit tests of the zapping controller (abort/debounce).

### LIV-03 — Remember last channel and navigation state
- **Priority:** Must · **Effort:** 2 · **Value:** Medium
- **Story:** As a user, I want the app to open where I left it, so that I can resume without searching again.
- **AC:**
  1. Given I left the app on Live › Sports › channel X, When I reopen it, Then I am in that category with channel X selected and visible (scroll restored).
  2. Given the option "Play last channel on open" (off by default, out of respect for mobile data and autoplay), When enabled, Then it starts muted if the browser blocks autoplay with sound, with an "Unmute" button.
  3. Given the active source was removed, Then it falls back to Home without errors.
- **Dependencies:** LIV-02, FND-05.
- **Tests:** E2E (reload).

### LIV-04 — Quick channel filter
- **Priority:** Must · **Effort:** 2 · **Value:** High
- **Story:** As a user, I want to type part of a channel's name or number and see results immediately, so that I reach it in seconds.
- **AC:**
  1. Given the filter field in the current category, When I type "sport", Then the list filters in < 100 ms, ignoring case and accents.
  2. Given a number ("101"), Then the channel with that number is prioritized.
  3. Given `Esc`, Then the filter is cleared.
- **Dependencies:** LIV-01.
- **Tests:** normalization unit tests; component.

---

## E5 — Movies (VOD)

### VOD-01 — Movie grid by category
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want to browse movies by category with posters, so that I can choose what to watch.
- **AC:**
  1. Given the active source, Then categories as chips/list and a virtualized grid of posters (2:3) with title and year.
  2. Given sorting (Recently added · A–Z · Rating when available), Then the grid sorts without reloading from the network.
  3. Given missing/failed posters, Then a tonal placeholder with the title.
  4. Given "Continue watching" for movies with progress, Then a progress bar on the card.
- **Dependencies:** FND-05, FND-04, UX-02, SRC-07.
- **Tests:** component with 10k items; E2E.

### VOD-02 — Movie details
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want to see synopsis, duration, year, genre and rating before playing, so that I can decide whether to watch.
- **AC:**
  1. Given Xtream, When I open the details, Then `get_vod_info` is requested (24 h cache) and the available fields are shown; missing ones leave no empty gaps.
  2. Given text coming from the server, Then it is rendered as text (never HTML).
  3. Given "Play"/"Resume at mm:ss", Then the player opens.
  4. Given a `get_vod_info` failure, Then the basic data from the list is shown and playback is allowed.
- **Dependencies:** VOD-01, PLY-02.
- **Tests:** mapping unit tests; component; MSW.

### VOD-03 — VOD playback with resume
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want to continue a movie where I stopped, so that I don't have to find the spot manually.
- **AC:**
  1. Given VOD playback, Then the position is saved every 10 s, on pause, and on exit (`pagehide`/`visibilitychange`).
  2. Given a saved position between 1 min and 95 % of the duration, Then the details show "Resume at mm:ss" and "Start from the beginning".
  3. Given > 95 %, Then it is marked as watched and removed from "Continue watching".
  4. Given the server does not support *range requests* (seek fails), Then a warning and playback from the beginning.
- **Dependencies:** VOD-02, FAV-02.
- **Tests:** policy unit tests; E2E with a test MP4.

### VOD-04 — Movie/series classification in M3U sources
- **Priority:** Must · **Effort:** 3 · **Value:** Medium
- **Story:** As a user of an M3U list, I want movies and series to appear in the right sections when the list allows it, so that everything isn't mixed into live TV.
- **AC:**
  1. Given URLs with `/movie/` or `/series/` (Xtream pattern), Then classified as movie/series.
  2. Given a `group-title` with common prefixes ("VOD", "Movies", "Filmes", "Series", "Séries") or `.mp4/.mkv/.avi` extensions, Then classified with configurable rules.
  3. Given M3U series with an `S01E02`/`S01 E02`/`1x02` pattern in the name, Then grouped by series and season.
  4. Given uncertain classification, Then it stays in Live (safe behavior) and the rule is documented.
- **Dependencies:** SRC-04.
- **Tests:** unit with an examples table (≥ 40 cases).

---

## E6 — Series

### SER-01 — Series grid
- **Priority:** Must · **Effort:** 2 · **Value:** High
- **Story:** As a user, I want to browse series by category, so that I find what to follow.
- **AC:** same as VOD-01 (AC1–3) applied to series; the card shows the number of seasons when known.
- **Dependencies:** VOD-01 (reuses grid components).
- **Tests:** component; E2E.

### SER-02 — Series details, seasons and episodes
- **Priority:** Must · **Effort:** 5 · **Value:** High
- **Story:** As a user, I want to see episodes organized by season, so that I choose the right episode.
- **AC:**
  1. Given Xtream, When I open the series, Then `get_series_info` is requested (cached in `seriesDetails`, TTL 24 h) and it shows seasons in order and episodes by number.
  2. Given seasons without metadata, Then names "Season N".
  3. Given episode progress, Then each episode shows watched/in progress; the series shows "Continue S2 E5".
  4. Given grouped M3U (VOD-04 AC3), Then the same UI with local data.
  5. Given a malformed response (episodes as object vs array — a known variation between panels), Then it is normalized.
- **Dependencies:** SER-01, PLY-02.
- **Tests:** normalization unit tests with fixtures of 3 variants; component.

### SER-03 — Play episode, resume and next episode
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want the next episode offered at the end, so that I can watch a series without interruptions.
- **AC:**
  1. Given an episode, Then resume follows the VOD-03 rules.
  2. Given ≤ 20 s remaining (or credits not detectable: on `ended`), Then a "Next episode in 10 s" card with Cancel; it moves on to the next season when applicable.
  3. Given the last episode, Then nothing is offered.
- **Dependencies:** SER-02, VOD-03.
- **Tests:** next-episode logic unit tests; E2E with short MP4s.

---

## E7 — Program guide (EPG)

### EPG-01 — Now/next via Xtream
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want to see the current and next program of each channel, so that I can decide what to watch.
- **AC:**
  1. Given the channel being played, Then it shows "Now" (title, times, progress bar) and "Next" via `get_short_epg` (base64 titles decoded as UTF-8).
  2. Given the channel list, Then EPG is requested only for visible rows (max. 6 concurrent requests, 300 ms scroll debounce, 5 min cache).
  3. Given no EPG, Then nothing is shown (no "N/A" on every row).
  4. Given time zones, Then times are shown in the device's time zone (use `start_timestamp`/`stop_timestamp`).
- **Dependencies:** LIV-01, SRC-02.
- **Tests:** decoding/time unit tests; MSW.
- **Risks:** some panels rate-limit requests → honor 429 with backoff.

### EPG-02 — Import XMLTV EPG
- **Priority:** Should · **Effort:** 5 · **Value:** Medium
- **Story:** As an M3U user, I want the EPG referenced by the list (or a URL I provide) to be loaded, so that I can see the schedule.
- **AC:**
  1. Given `url-tvg` or a manual URL (`.xml`, `.xml.gz` or `.xml.xz`), Then it downloads as a stream, decompresses (`DecompressionStream` for gzip; a small permissively-licensed xz decoder for `.xz`, which browsers cannot decompress natively — real lists such as M3UPT publish `.xml.xz`) and SAX-parses in the worker.
  2. Given the configured window (−2 h to +48 h), Then only those programs are stored.
  3. Given a 100 MB decompressed file, Then the UI stays responsive and worker memory < 200 MB (measured on desktop).
  4. Given a 12 h refresh, Then finished programs are purged.
  5. Given XML entities and CDATA, Then the text is correct; never interpreted as HTML.
- **Dependencies:** FND-07, FND-05, EPG-03 (can be done in parallel with an agreed contract).
- **Tests:** parser unit tests with fixtures; benchmark.

### EPG-03 — Channel ↔ EPG matching
- **Priority:** Should · **Effort:** 3 · **Value:** Medium
- **Story:** As a user, I want the schedule to appear on the right channel, so that I can trust the guide.
- **AC:**
  1. Given `tvg-id` equal to `channel@id`, Then exact match.
  2. Given no `tvg-id`, Then match by normalized name (no accents, lowercase, without "HD/FHD/4K/+1", country prefixes "PT:", "PT |").
  3. Given an ambiguous match, Then it does not associate (avoid false positives) and counts as "no EPG".
  4. Given the diagnostics, Then it shows the % of channels with EPG.
  5. Given manual correction (optional, Could), Then the user can associate a channel with an EPG id.
- **Dependencies:** EPG-02 (interface), LIV-01.
- **Tests:** unit with a table of ≥ 50 pairs.

### EPG-04 — EPG grid view
- **Priority:** Could · **Effort:** 8 · **Value:** Medium
- **Story:** As a user, I want a time grid of several channels, so that I can plan what to watch.
- **AC:** grid virtualized on 2 axes; "now" line; keyboard navigation; performance ≥ 55 fps with 500 channels × 24 h.
- **Dependencies:** EPG-03.
- **Risks:** high complexity; split into sub-stories before starting.

---

## E8 — Search

### SCH-01 — Search index in the worker
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want to search across thousands of items instantly, so that I find any channel, movie or series.
- **AC:**
  1. Given the end of a sync, Then the MiniSearch index (fields: normalized name; stored: key, type, category) is built in the worker and serialized into `searchIndex`.
  2. Given the app reopened, Then the index is loaded from IndexedDB (no rebuild) in < 1 s for 100k items (average desktop).
  3. Given a prefix search and a 1-letter typo in terms ≥ 5 letters, Then the item is found (fuzzy 0.2).
  4. Given NFR-04, Then it is met.
- **Dependencies:** FND-07, SRC-07/SRC-05.
- **Tests:** unit + benchmark.

### SCH-02 — Global search (UI)
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want a single search field that shows channels, movies and series, so that I don't need to know where the content is.
- **AC:**
  1. Given `/` or the 🔍 icon, Then search opens with focus on the field.
  2. Given ≥ 2 characters, Then results grouped by type (max. 20 per group + "see all"), updated with a 120 ms debounce.
  3. Given a result, Then channel → plays; movie/series → details.
  4. Given recent searches, Then the last 10 are stored locally, with a clear option.
  5. Given no results, Then an empty state.
- **Dependencies:** SCH-01, FND-04.
- **Tests:** component + E2E.

---

## E9 — Favorites and history

### FAV-01 — Favorites
- **Priority:** Must · **Effort:** 2 · **Value:** High
- **Story:** As a user, I want to mark channels, movies and series as favorites, so that I find them quickly.
- **AC:**
  1. Given an item, When I tap ★ (or the `F` key), Then the favorite toggles with immediate (optimistic) feedback and an announcement for screen readers.
  2. Given a re-sync, Then favorites persist; items that no longer exist appear as "unavailable" with a remove option.
  3. Given favorites per source, Then only those of the active source appear.
- **Dependencies:** FND-05.
- **Tests:** repo unit tests; component.

### FAV-02 — History and "Continue watching"
- **Priority:** Must · **Effort:** 2 · **Value:** High
- **Story:** As a user, I want to see the channels I watched recently and what I was watching, so that I can return with one tap.
- **AC:**
  1. Given a channel played for > 5 s, Then it enters "Recent" (max. 30, most recent first, no duplicates).
  2. Given VOD/episodes with progress, Then they appear in "Continue watching" (max. 20).
  3. Given "Clear history", Then history is removed (not favorites).
- **Dependencies:** FND-05.
- **Tests:** repo unit tests.

### FAV-03 — Favorites and Home screens
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want a home screen with what I'm watching, recents and favorites, so that I can start watching in one tap.
- **AC:**
  1. Given data, Then Home shows the sections "Continue watching", "Recent channels", "Favorites" (each hidden if empty).
  2. Given the Favorites screen, Then tabs Channels/Movies/Series.
  3. Given no data, Then an empty state with shortcuts.
- **Dependencies:** FAV-01, FAV-02, LIV-02, VOD-01, SER-01.
- **Tests:** component; E2E.

---

## E10 — PWA

### PWA-01 — Manifest, icons and installability
- **Priority:** Must · **Effort:** 2 · **Value:** High
- **Story:** As a user, I want to install the app on my home screen, so that I can open it like a normal app.
- **AC:**
  1. Given the manifest, Then it has `name`, `short_name`, `start_url` and `scope` consistent with the Pages `base`, `display: standalone`, `theme_color`/`background_color` from the tokens, 192/512 icons + `maskable`, `screenshots` (mobile and desktop).
  2. Given iOS, Then `apple-touch-icon`, `apple-mobile-web-app-*` meta and a reasonable splash.
  3. Given Chrome/Edge, When eligible, Then an "Install app" button in Settings uses `beforeinstallprompt`; on iOS it shows the instructions "Share → Add to Home Screen".
  4. Given Lighthouse, Then the installability criteria are met.
- **Dependencies:** FND-01.
- **Tests:** Lighthouse CI (QA-03); manual iOS/Android.

### PWA-02 — Service worker and caching strategy
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want the app to open quickly even without network, so that I can check favorites and settings.
- **AC:**
  1. Given the build, Then the SW (vite-plugin-pwa, `generateSW`) precaches the app shell (HTML, JS, CSS, fonts, icons).
  2. Given requests to other hosts (API, streams, images, EPG), Then `NetworkOnly`/no interception — **no URL with credentials enters Cache Storage** (an automated test lists `caches` after an E2E session).
  3. Given offline navigation, Then the app opens and shows data from IndexedDB.
- **Dependencies:** PWA-01.
- **Tests:** Playwright E2E with `context.setOffline(true)`; cache inspection.

### PWA-03 — Predictable updates
- **Priority:** Must · **Effort:** 2 · **Value:** Medium
- **Story:** As a user, I want to be notified when there is a new version and choose when to update, so that I don't lose ongoing playback.
- **AC:**
  1. Given a new version detected, Then a snackbar "New version available — Update".
  2. Given ongoing playback, Then the update is never applied automatically.
  3. Given "Update", Then `skipWaiting` + reload, preserving the route.
  4. Given an IndexedDB migration in a new version, Then it runs before the UI and with an indicator.
- **Dependencies:** PWA-02.
- **Tests:** E2E with two builds (simulated versions).

### PWA-04 — Offline state and network errors
- **Priority:** Must · **Effort:** 2 · **Value:** Medium
- **Story:** As a user, I want to know when I'm offline, so that I understand why I can't play.
- **AC:**
  1. Given `navigator.onLine=false` or consecutive failures, Then a persistent "No connection" banner; network actions disabled with an explanation.
  2. Given the connection returns, Then the banner disappears and pending tasks (scheduled sync) resume.
  3. Given the app, Then it never promises offline playback.
- **Dependencies:** UX-02.
- **Tests:** offline E2E.

### PWA-05 — Persistent storage and quota
- **Priority:** Must · **Effort:** 1 · **Value:** Medium
- **Story:** As a user, I want the browser not to delete my data, so that I don't have to set the app up again.
- **AC:**
  1. Given the first source added, Then `navigator.storage.persist()` is requested and the result shown in Settings › Storage, with the space used (`estimate()`).
  2. Given iOS not installed, Then the warning "Install the app to prevent Safari from deleting your data after 7 days without use".
- **Dependencies:** FND-05.
- **Tests:** unit with mocked APIs.

---

## E11 — Cross-cutting UX and accessibility

### UX-01 — First-run onboarding
- **Priority:** Must · **Effort:** 2 · **Value:** High
- **Story:** As a new user, I want to be guided to add my first source, so that I can start without reading instructions.
- **AC:**
  1. Given no source, Then any main route redirects to onboarding (except Settings/Privacy).
  2. Given the screen, Then it shows the 3 options from `UX_UI.md §4.1` and the note "we don't include channels / data stays on the device".
  3. Given completion, Then `onboardingDone` and redirect to Home.
- **Dependencies:** FND-04.
- **Tests:** E2E.

### UX-02 — State and feedback components
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want to always understand what the app is doing, so that I can trust it.
- **AC:**
  1. Given `StateView` (loading/skeleton, empty, error, offline) and `Toast`, Then they are used by every feature (no ad hoc variants).
  2. Given loading < 300 ms, Then nothing flashes.
  3. Given an error, Then message + action + "Details" (redacted).
- **Dependencies:** FND-03.
- **Tests:** component + axe.

### UX-03 — Keyboard navigation and accessibility audit
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a keyboard or screen reader user, I want to use all the main functions, so that I don't depend on mouse or touch.
- **AC:**
  1. Given the flows add source → watch channel → change channel → open movie → search, Then they can be completed with the keyboard only (E2E test).
  2. Given axe on every route, Then 0 serious/critical violations.
  3. Given a "Skip to content" skip link, Then it is present.
  4. Given NVDA/VoiceOver (manual), Then the zapping flow is announced correctly.
- **Dependencies:** LIV-02, VOD-02, SCH-02, SRC-03.
- **Tests:** axe E2E; manual checklist.

### UX-04 — Settings, privacy and "about"
- **Priority:** Must · **Effort:** 2 · **Value:** Medium
- **Story:** As a user, I want a simple settings screen, so that I can adjust theme and behavior and read about privacy.
- **AC:**
  1. Given Settings, Then sections: Sources · Appearance (theme) · Playback (fullscreen in landscape, play last channel, preferred live format Auto/TS/HLS) · Storage · Privacy (what we store, delete data) · About (version, open source licenses, legal notice).
  2. Given "Licenses", Then a list generated at build time from the dependencies.
  3. Given the legal notice, Then "The app does not provide content; it only uses sources you are authorized to access".
- **Dependencies:** FND-04, SRC-08.
- **Tests:** component.

### UX-06 — Interface language (English / Português)
- **Priority:** Must · **Effort:** 2 · **Value:** Medium
- **Story:** As a user, I want to use the app in English or Portuguese, so that I understand every screen.
- **AC:**
  1. Given first launch, When the browser language starts with `pt`, Then the UI is pt-PT, otherwise English.
  2. Given Settings › Language (System / English / Português), When I change it, Then all visible text switches immediately without reload and the choice persists (`settingsRepo`).
  3. Given the active locale, Then `<html lang>` is `en` or `pt-PT`.
  4. Given the pt-PT messages, Then the TypeScript type check fails if any key from `en` is missing.
  5. Given dates/times (EPG, expiry), Then they are formatted with `Intl` for the active locale.
- **Dependencies:** FND-04, FND-05.
- **Tests:** unit for locale detection and switching; component test switching language; type-level completeness check.
- **Risks:** longer pt-PT strings truncating layouts.

### UX-05 — D-pad / TV remote navigation
- **Priority:** Should · **Effort:** 5 · **Value:** Medium
- **Story:** As a user on a TV or Android box, I want to navigate with the remote's arrow keys, so that I can use the app from the couch.
- **AC:** spatial focus in grids and lists; remote "back" key; focus is never lost; channel keys (`ChannelUp/ChannelDown`) supported.
- **Dependencies:** UX-03.

### UX-07 — Mark protected content
- **Priority:** Should · **Effort:** 3 · **Value:** Medium
- **Story:** As a user of an M3U list that mixes DRM/DASH entries with playable ones, I want protected channels, movies and series to be marked (and optionally hidden), so that I don't pick something the app can't play.
- **Context:** lists such as public M3U lists contain DASH + DRM entries (ClearKey license keys in `#KODIPROP`). The app refuses to play them and never uses DRM keys from lists (SECURITY.md §8); until now they looked playable until Play was pressed.
- **AC:**
  1. Given an item whose stream is DRM-flagged or DASH (the import stores `drm`/`container` on channels, movies and grouped episodes), Then it shows a "Protected" badge (poster cards in grids, channel rows, episode rows, details hero, Home cards, search results) with an accessible label, and Play is disabled with a short explanation ("Protected content (DRM/DASH) can't be played in this app"). Playback is never attempted.
  2. Given a series whose episodes are all protected, Then the badge shows in the grid and on its details; given a mixed series, Then only its protected episode rows are marked. "All protected" is computed at import and stored as a non-indexed flag on the series row (no schema version change; a re-sync applies it).
  3. Given Settings › Playback "Hide protected content" (default off, persisted via `settingsRepo`), When it is on, Then protected items are left out of the Live, Movies and Series grids, search results and Home rows, with correct counts and empty states.
  4. Given the strings, Then they exist in en and pt-PT.
- **Dependencies:** SRC-04, VOD-04, UX-04.
- **Tests:** unit (protection rule, import flag, sort/search/pager filtering, Home data); component (badges, disabled Play, hidden items, setting).
- **Risks:** filtering paged Live categories needs one read of the category's keys when the setting is on (M3U lists only; Xtream items are never flagged).

---

## E12 — Security and privacy

### SEC-01 — CSP, URL validation and sanitization
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a user, I want malicious lists or metadata to be unable to execute code in the app, so that my credentials are protected.
- **AC:**
  1. Given `index.html`, Then `<meta http-equiv="Content-Security-Policy">` with `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` (Emotion), `img-src * data: blob:`, `media-src * blob:`, `connect-src *` (required: the user's servers), `worker-src 'self' blob:`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`.
  2. Given any external URL (source, logo, stream, EPG), Then it is validated: only `http:`/`https:`; credentials in `userinfo` are rejected except when necessary and are never displayed.
  3. Given metadata (names, synopses), Then rendered as text; lint forbids `dangerouslySetInnerHTML` (ESLint rule).
  4. Given external links (e.g. YouTube trailer in VOD info), Then `rel="noopener noreferrer"` and confirmation.
  5. Given `Referrer-Policy`, Then `<meta name="referrer" content="no-referrer">` so that the app's origin does not leak to IPTV servers.
- **Dependencies:** FND-01.
- **Tests:** validation unit tests; E2E with an M3U containing XSS payloads (`<img onerror>`, `javascript:`).

### SEC-02 — Master password (lock)
- **Priority:** Should · **Effort:** 5 · **Value:** Medium
- **Story:** As a privacy-conscious user, I want to protect the credentials with a password only I know, so that whoever picks up the device cannot use them.
- **AC:** PBKDF2-SHA-256 ≥ 600k iterations + salt; key never persisted; re-encryption of all secrets when enabling/disabling; lock on open and after N min in the background; no recovery (explicit warning).
- **Dependencies:** SRC-01.

### SEC-03 — Parental control with PIN
- **Priority:** Could · **Effort:** 3 · **Value:** Low
- **Story:** As a parent, I want to hide categories behind a PIN, so that I can limit children's access.
- **AC:** marked categories require a PIN; PIN stored as a hash; warning that it is a deterrent, not strong protection.
- **Dependencies:** LIV-01, VOD-01.

---

## E13 — Quality and release

### QA-01 — Fixtures, mocks and test streams
- **Priority:** Must · **Effort:** 3 · **Value:** Medium (enabler)
- **Story:** As a developer, I want synthetic, legal test data and streams, so that I can test without depending on real providers.
- **AC:**
  1. Given `fixtures/`, Then: Xtream responses (3 panel variants), M3U (small, malformed, 50k generated), XMLTV (small, gz), malicious payloads.
  2. Given test streams, Then generated locally (ffmpeg in CI or small committed files < 2 MB): HLS H.264/AAC, multi-audio HLS, TS H.264/AAC, TS with AC-3 (to test the error), short MP4; served by a local server with configurable CORS (on/off).
  3. Given MSW handlers, Then shared between Vitest and Playwright.
  4. Given no fixture, Then contains real provider data.
- **Dependencies:** FND-01.
- **Risks:** ffmpeg not installed locally (check; alternative: generate in CI or commit small files with their own license).

### QA-02 — Playwright E2E + axe
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As a maintainer, I want end-to-end tests of the critical flows in Chromium, WebKit and Firefox, so that nothing breaks between versions.
- **AC:**
  1. Given CI, Then it runs smoke E2E (mock Xtream onboarding → live → zapping → movie → search → favorites → delete data) in Chromium, WebKit and Firefox, mobile and desktop viewports.
  2. Given each route, Then axe with no serious/critical violations.
  3. Given a failure, Then traces and videos are saved as artifacts.
- **Dependencies:** FND-02, QA-01 (full flows depend on the features — the suite grows with them).

### QA-03 — Performance budgets (Lighthouse CI)
- **Priority:** Must · **Effort:** 2 · **Value:** Medium
- **Story:** As a user, I want an app that opens quickly on my phone, so that I don't wait.
- **AC:**
  1. Given Lighthouse CI (mobile), Then Performance ≥ 90, A11y ≥ 95, Best Practices ≥ 95; CI fails below that.
  2. Given `size-limit` (or equivalent), Then initial JS ≤ 200 KB gz; hls chunk ≤ 190 KB gz (full build, ADR-017); mpegts ≤ 80 KB gz; both lazily loaded and absent from the initial chunks.
  3. Given the report, Then it is published as a CI artifact.
- **Dependencies:** FND-02, FND-03.

### DEP-01 — Deploy to GitHub Pages
- **Priority:** Must · **Effort:** 2 · **Value:** High
- **Story:** As a user, I want to access the app at a public HTTPS address, so that I can use and install it on any device.
- **AC:**
  1. Given a push to `main` with green CI, Then the workflow publishes `dist/` via `actions/deploy-pages`.
  2. Given the URL `https://<user>.github.io/<repo>/`, Then app, SW and manifest work with the correct `base`.
  3. Given a deploy failure, Then the previous version remains.
- **Dependencies:** FND-02, PWA-01. **Requires explicit user approval (publication).**
- **Tests:** smoke E2E against the published URL (separate job).

### DEP-02 — Manual validation on devices
- **Priority:** Must · **Effort:** 3 · **Value:** High
- **Story:** As the product owner, I want to confirm the real behavior on Android, iOS and desktop, so that compatibility is not claimed without proof.
- **AC:**
  1. Given the checklist in `TEST_PLAN.md §5`, Then it is executed on: Android (Chrome), iPhone (Safari + installed PWA), desktop (Chrome, Firefox, Safari if available).
  2. Given the results, Then `docs/progress/compatibility-matrix.md` is updated with date, OS/browser version and result.
- **Dependencies:** MVP release candidate.

---

## E14 — Post-MVP / experimental

### EXP-01 — Export/import settings
- **Priority:** Should · **Effort:** 3 · **Value:** Medium
- **Story:** As a user with several devices, I want to export sources, favorites and settings to a file and import it on another device, so that I don't have to set everything up again.
- **AC:** versioned JSON file; secrets included only if the user sets an export password (AES-GCM + PBKDF2); import with preview and merge/replace; schema validation (untrusted file).
- **Dependencies:** SRC-08, FAV-03.

### PRX-01 — Reference self-hosted proxy
- **Priority:** Could (may move up to Must — ADR-010) · **Effort:** 5 · **Value:** High if the provider is HTTP-only
- **Story:** As a user whose provider only has HTTP, I want to specify my own proxy, so that I can play in the browser.
- **AC:**
  1. Given Settings › Personal proxy (HTTPS URL + token), Then `UrlRewriter` rewrites requests (API, playlists, segments, streams) to the proxy.
  2. Given the project, Then it includes `proxy/` with a minimal implementation (Node, no dependencies) with: host allowlist configured by the owner, mandatory token, no URL logging, unbuffered streaming, HLS playlist rewriting.
  3. Given documentation, Then a guide to expose it via HTTPS (e.g. Tailscale Serve) and security warnings (SSRF, exposure to the internet).
- **Dependencies:** PLY-01, SRC-02, ADR-010.

### NAT-01 — Android shell (Capacitor) — experimental
- **Priority:** Could · **Effort:** 8 (split before starting) · **Value:** High for Android users with HTTP-only providers
- **Story:** As an Android user, I want an APK that uses the same app without the browser's restrictions, so that I can play HTTP-only providers.
- **AC:** same codebase; `CapacitorHttp` for the API; cleartext allowed only for the user's hosts; APK build via GitHub Actions; no Play Store initially.
- **Dependencies:** complete MVP.

### PRF-01 — Multiple profiles
- **Priority:** Could · **Effort:** 5 · **Value:** Low/Medium
- **AC:** favorites, history and preferences per profile; shared sources; profile selection on open (optional).

### CST-01 — Remote Playback / Cast — experimental
- **Priority:** Could · **Effort:** 5 · **Value:** Medium
- **AC:** AirPlay button (Safari, native engine) and Remote Playback API where supported; Cast SDK only after evaluating requirements (streams must be reachable by the receiver).

### MSS-01 — Media Session
- **Priority:** Should · **Effort:** 1 · **Value:** Low
- **AC:** title/artwork on the lock screen and play/pause/previous/next controls where supported.

---

## E15 — Technical follow-ups (added 2026-10-29)

### TEC-01 — Load feature strings with their feature
- **Priority:** Must · **Effort:** 3 · **Value:** Medium (performance budget)
- **Story:** As a user on a slow phone, I want the app to start fast, so that new features don't make every launch slower.
- **AC:** (1) Given the initial bundle, Then it contains only the strings of the shell, onboarding guard, state views and errors; each feature's strings (live, movies, series, sources, player…) load with that feature's lazy chunk. (2) Given the type-level completeness check between `en` and `pt-PT`, Then it still fails on a missing key. (3) Given the locale switch (UX-06), Then lazily loaded strings follow the active locale. (4) Initial JS drops by at least the size of the feature string files (measured with the manifest closure).
- **Dependencies:** none. **Risk:** touches every feature's imports — run alone (serialized).

### TEC-02 — Extract shared feature helpers into `src/ui`
- **Priority:** Should · **Effort:** 3 · **Value:** Low (maintainability)
- **Story:** As a maintainer, I want one copy of the helpers duplicated between Live and Movies (active-source hook, fill-height hook, category nav, page cache, image checks, stable colour hash), so that fixes apply everywhere.
- **AC:** no duplicated helper remains in `features/*`; behaviour and tests unchanged.
- **Dependencies:** VOD-01, LIV-03.

### LIV-05 — Live player integration follow-ups
- **Priority:** Must · **Effort:** 2 · **Value:** Medium
- **Story:** As a user, I want the channels panel in fullscreen and one clear message for restricted channels, so that the Live player behaves consistently.
- **AC:** (1) LivePlayer passes `requiredHeaders` to PlayerView and drops its own "restricted" banner (one message, from the player overlay). (2) The channels panel (L) is rendered inside the fullscreen element (PlayerView overlay slot), so it works in fullscreen. (3) LivePlayer ignores errors while PlayerView is reconnecting (only final errors count).
- **Dependencies:** PLY-03, PLY-04, LIV-03.
