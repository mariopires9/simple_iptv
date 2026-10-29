# Security, privacy and legal limits

## 1. Threat model (summary)
| Asset | Threat | Mitigation | Residual risk |
|---|---|---|---|
| Xtream credentials / M3U URLs | Reading of app data (backup, profile copy, casual forensic tool) | AES-GCM with non-exportable key (ADR-006) | Anyone using the unlocked device on the same origin can use the credentials |
| Credentials | XSS via malicious metadata/lists | Rendering as text only, CSP without `unsafe-eval`/external scripts, lint against `dangerouslySetInnerHTML`, URL validation | Vulnerability in a dependency |
| Credentials | Exposure in logs/errors/reports | Central redaction (FND-06), property tests | — |
| Credentials | Visible in stream URLs (Xtream protocol) | Inherent to the protocol; documented | Visible in DevTools and to the IPTV server/proxy |
| Credentials | `Referer` leak to third parties | `no-referrer` | — |
| Privacy | Telemetry/tracking | No analytics; self-hosted fonts; E2E domain allowlist test | — |
| Integrity | Compromised dependency (supply chain) | Lockfile, `npm ci`, Dependabot, audit, Actions pinned by SHA, few dependencies | Cannot be eliminated |
| Availability | Huge/malicious list (local DoS) | Parsing in a worker, limits (64 KB line length, configurable number of entries, warning > 50 MB) | — |

## 2. Credential storage — what we tell the user (text for UX-04)
> "Your credentials are stored only on this device, encrypted. This prevents casual reading of the app's data, but does **not** protect against someone with access to your unlocked device. Your credentials are also part of the channel addresses, which are sent to your provider. You can delete everything in Settings › Privacy."

The pt-PT version of this text lives in `src/i18n/pt-PT/`.

Documented limitations:
- Stream URLs from M3U lists are stored **unencrypted** (cost of encrypting tens of thousands of URLs). If the list comes from an Xtream server (`get.php`), the app offers to convert it into an Xtream source, where only the password is stored (encrypted).
- A client-side application **cannot** hide credentials from the user themselves or from the browser.

## 3. Importing lists and URLs
- Accepted schemes: `http:` and `https:` only. Rejected: `javascript:`, `data:`, `file:`, external `blob:`, `ftp:`, etc.
- URLs with embedded credentials (`user:pass@host`) are rejected (`credentials` reason): browsers refuse `fetch()` of such URLs and block subresource requests carrying them, so accepting them would only produce confusing failures. Xtream credentials go in the source form, never in the URL.
- URLs shown in the UI go through `displayUrl()` (no userinfo, query or fragment; Xtream credential paths masked).
- Names, groups, synopses: plain text; truncated to a maximum length (e.g. 512 chars for names, 8 KB for synopses).
- External images: `<img>` with `referrerpolicy="no-referrer"`, without `crossorigin` (avoids CORS); failures → fallback.
- Imported files (M3U, JSON export): treated as untrusted, validated by schema.

## 4. SSRF and proxy (only if PRX-01 goes ahead)
The MVP has no backend → there is no SSRF on our side. The reference proxy, if created, must: require a token; apply an owner-defined host allowlist; block private/loopback/link-local IPs and cloud metadata (169.254.169.254) **after** DNS resolution; restrict methods to GET/HEAD; not log URLs or query strings; rate-limit. Documentation must warn against exposing the proxy publicly without a token.

## 5. Dependencies and licenses
- License allowlist in CI (FND-02). All planned dependencies are MIT/Apache-2.0/ISC/OFL.
- Codecs: the app **does not distribute codecs**; it uses those of the browser/OS. There are no H.264/HEVC/AAC/AC-3 licensing fees for the app (they are the responsibility of the browser/OS).
- hls.js and mpegts.js: Apache-2.0 → include the license notice in "About › Licenses".

## 6. PWA permissions
No sensitive permissions are requested. Used only: persistent storage (`storage.persist`), fullscreen, PiP, orientation (optional). **Not** requested: notifications, location, camera, microphone, local network (except, in the future, if the user configures a proxy on the LAN — Chrome LNA).

## 7. Data deletion
- "Delete all data" (SRC-10): IndexedDB (includes the vault key), data Cache Storage, `localStorage`/`sessionStorage` if used. The user can also uninstall the PWA or clear the site data in the browser.
  - Implemented in `src/features/settings/privacy/deleteAllData.ts`: the data worker is terminated, the `simple-iptv` database is deleted (vault secrets and device key with it), this app's caches except the app-shell precache are deleted (the precache holds build files only and keeps the app starting offline; the service worker registration stays, AC2), only this app's Web Storage keys are removed (`simple-iptv:*`, React Router scroll positions — the origin may be shared with other apps on GitHub Pages); this tab's database is locked (no reopen until reload) and the other tabs are told on an app-scoped BroadcastChannel (they lock and restart); once the database is gone the log redactor's secrets and log buffer are cleared and the page reloads on onboarding (resetting every in-memory store).
- Local M3U file (SRC-06): the picked `File` goes to the data worker by structured clone and is read as a stream; it is never stored — only the parsed catalogue is. A file source has nothing in the vault.
- Removing a source deletes that source's data in cascade.

## 8. Legal limits and positioning
- The app is a **generic player** (like VLC or a browser): it does not provide, host, index or suggest content or lists.
- It does not include third-party lists, directories, or search of public lists.
- It does not implement or bypass DRM, authentication or geographic restrictions.
- It does not record or download streams.
- Notice in onboarding and in "About": "Use only sources and content you are authorized to access." (the pt-PT version lives in `src/i18n/pt-PT/`).
- Distinction: the **app hosting** (free, GitHub Pages) is independent of the user's **IPTV services**, which have their own costs, terms and limitations (e.g. maximum number of connections).
- Own name and visual identity; do not use trademarks, icons or screenshots of other apps (including "Smarters").

## 9. Security checklist per sensitive story
Stories that touch `core/crypto`, `core/net`, `core/log`, `providers/*`, parsers, CSP or SW require `/security-review` in addition to `/code-review`, plus regression tests for every fixed finding.
