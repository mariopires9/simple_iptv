# Security, privacy and legal limits

## 1. Threat model (summary)
| Asset | Threat | Mitigation | Residual risk |
|---|---|---|---|
| Xtream credentials / M3U URLs | Reading of app data (backup, profile copy, casual forensic tool) | AES-GCM with non-exportable key (ADR-006) | Anyone using the unlocked device on the same origin can use the credentials |
| Credentials | Someone using the device (unlocked browser profile) | Optional master password (SEC-02, Settings › Privacy): PBKDF2-SHA-256 (600 000 iterations, random salt) → non-extractable AES-GCM 256 key held in memory only; every vault secret is re-encrypted with it (one IndexedDB transaction, verified before commit; turning it off re-encrypts with the device key). Stored: salt, iteration count, key id and an encrypted known value (verifier). Locked on open and after N minutes in the background (default 5); while locked, vault reads/writes and secret-reading worker tasks wait for the unlock; the data worker receives the key by structured clone and drops it on lock. No recovery: "forgot" = delete all data (SRC-10) | A weak master password can be brute-forced offline from a copy of the database; while unlocked, same residual risks as the device key; values already derived from secrets (stream URLs of a playing channel) stay in memory after a lock |
| Credentials | XSS via malicious metadata/lists | Rendering as text only, CSP without `unsafe-eval`/external scripts, lint against `dangerouslySetInnerHTML`, URL validation | Vulnerability in a dependency |
| Credentials | Exposure in logs/errors/reports | Central redaction (FND-06), property tests | — |
| Credentials | Export file (EXP-01) copied, shared or left in Downloads | Secrets (Xtream passwords, M3U list URLs, proxy token) are written only when the user sets an export password: AES-GCM 256, key from PBKDF2-SHA-256 (600 000 iterations, random salt, random IV), WebCrypto; never the device key. A crafted file on import: a proxy address is applied only with its decrypted token (never paired with this device's token); a list keeps its stored password only if its server origin and username are unchanged | Server URL, username and list names are in plain text; a weak export password can be brute-forced offline |
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

## 4. SSRF and the personal proxy (PRX-01, ADR-010)
The static app has no backend. The optional personal proxy (`proxy/`, guide in `proxy/README.md`) is a dependency-free Node 24 relay that the **owner** runs on their own PC, bound to loopback and reachable only inside their tailnet through Tailscale Serve (HTTPS). It exists because the provider's streams redirect to `http://` edge hosts, which an HTTPS page cannot load (mixed content). Implemented policy:

- **Not an open proxy.** Every path carries a token (`/v1/<token>/…`, 32–128 chars of `[A-Za-z0-9_-]`, generated from 32 random bytes); it is compared in constant time (`timingSafeEqual` of SHA-256 digests); tokens in query strings are ignored. Global limits: a token bucket (`requestsPerMinute`), a bad-token lockout (after `badTokenPerMinute` failures every request gets 429 for 60 s; global because behind Serve every peer is 127.0.0.1) and `maxConcurrentUpstreams`. Methods: GET/HEAD and CORS preflight only; absolute-form requests answer 404 and CONNECT 405.
- **Optional upstream allowlist (PRX-02).** By default (`allowedHosts` left out) app-built `u` URLs may target **any public host**, so lists from any provider work without reconfiguring the proxy; the token, the address policy below (no private, loopback, tailnet or metadata targets) and the tailnet-only exposure are what keep it from being an open relay. When the owner sets `allowedHosts`, `u` URLs must match it (exact, case-insensitive, normalized with `new URL`, or a `*.` subdomain wildcard). URLs inside rewritten HLS playlists use `g` URLs carrying a **grant**: an expiring (24 h) HMAC over the exact upstream URL, keyed by a key derived from the token, so the proxy only relays what it wrote itself and a token rotation invalidates all grants.
- **SSRF, after DNS.** Only `http:`/`https:` without userinfo, ≤ 8 KiB. Every DNS answer of every hop is checked and the request is refused (403) if **any** answer is in a blocked range: IPv4 0/8, 10/8, 100.64/10 (CGNAT/Tailscale), 127/8, 169.254/16 (cloud metadata), 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4; IPv6 ::, ::1, fc00::/7, fe80::/10, ff00::/8, 100::/64, 2001:db8::/32, Teredo 2001::/32, 64:ff9b:1::/48, plus the embedded IPv4 of ::ffff:0:0/96, ::/96, 64:ff9b::/96 and 2002::/16. The socket receives only the vetted addresses (pinned `lookup`, no DNS rebinding); IP-literal hosts are checked explicitly. The address policy is not configurable (tests inject it in code only).
- **Redirects** (301/302/303/307/308) are followed inside the proxy, ≤ `maxRedirects` (5), each hop re-checked for scheme and address (https → http allowed, that is the purpose); they are never forwarded to the client. A redirect to a non-http(s) URL is a 502.
- **Header hygiene.** Upstream receives only `Range`, `If-Range`, `Accept`, `Accept-Encoding` (gzip/deflate/br) and `User-Agent` — never `Cookie`, `Authorization`, `Origin`, `Referer`, `X-Forwarded-*` or `Tailscale-*`. Responses pass only content type/length/range/encoding, `Accept-Ranges`, `Last-Modified`, `ETag` (never `Set-Cookie`) and always add `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `Content-Security-Policy: default-src 'none'; sandbox`. CORS: exact `Access-Control-Allow-Origin` for configured bare origins, `Vary: Origin`, a foreign `Origin` is refused with 403; requests without `Origin` (media elements) are allowed.
- **No URL logging.** `proxy/log.ts` is the only console user and accepts only a closed set of fields (event, status, error code, duration, bytes; port and counts at startup). Errors are reduced to `error.code`/`error.name`. Config errors name the field, never its value. A test spies on the console over the whole integration suite and asserts that no host, path, query, token or encoded URL is printed.
- **Streaming and resource limits.** `stream.pipeline` with backpressure, no buffering except HLS playlists (≤ `playlistMaxBytes`, 502 above). Upstream is aborted when the client disconnects (also mid-redirect), the upstream connection is never pooled, headers must arrive within 15 s (504) and a stream whose provider sends nothing for 30 s while the client reads is closed (a client that stops reading keeps it until it disconnects, PLY-07). IPTV M3U channel lists are passed through byte-identical.
- **Fail closed configuration.** The proxy refuses to start with an invalid token, empty `allowedOrigins`, an `allowedHosts` that is present but empty, an origin that is not a bare origin, a non-loopback listen address or unknown keys.

Residual risks, documented in `proxy/README.md`: the proxy (the owner's PC) sees the provider credentials embedded in stream URLs; PC → edge traffic is plain http; enabling Tailscale HTTPS certificates publishes the machine and tailnet names in Certificate Transparency logs; exposing the proxy to the internet (Tailscale Funnel, port forwarding, a public VPS) is unsafe and unsupported; anyone with the token **and** tailnet access can use the relay to reach any public host (or only the allowlist, when set) from the owner's home IP — keep the token private, rotate it if it leaks, and set `allowedHosts` for a tighter relay.

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
