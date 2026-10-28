# Product specification

## 1. Summary
**Simple IPTV** (working name) is a free IPTV player with no ads and no telemetry that runs in the browser and installs as a PWA on Android, iOS and desktop. Users connect **their own** sources (Xtream Codes or M3U lists) and watch live TV, movies and series through a modern, fast, mobile-first interface.

The app is a **generic player**: it does not include, suggest or distribute lists, channels or content.

## 2. Target users
| Persona | Need | Implication |
|---|---|---|
| Regular user with an IPTV subscription | "Paste the details my provider gave me and watch TV" | 1-screen onboarding, error messages in plain language |
| Technical user | Several lists, local M3U files, external EPG | Source management, detailed diagnostics |
| Desktop/TV user with a keyboard | Fast zapping | Keyboard shortcuts, visible focus |

## 3. Scope

### 3.1 MVP (mandatory) — v1.0
| Area | Included |
|---|---|
| Sources | Add Xtream (server, username, password) with connection test; import M3U by URL and from a local file; **"My lists"** page with all lists saved on the device (no limit on number), where lists are edited, refreshed, removed and the active list is chosen; error diagnostics (credentials, expired account, HTTPS, CORS, timeout); encrypted credentials; delete all data |
| Live TV | Categories; virtualized list with logos; quick filter; favorites; recents; player with zapping (previous/next, overlaid list); fullscreen; remember last channel and navigation state; now/next (Xtream) |
| Movies | Grid by category with posters; details (synopsis, year, duration, rating when available); playback; resume |
| Series | Grid by category; details with seasons and episodes; playback; resume; next episode |
| Search | Global search in the active source (channels, movies, series) |
| Favorites/History | Favorites for channels, movies and series; "Continue watching"; recent channels |
| UX | Dark (default) and light theme; language selection (EN/pt-PT); mobile/tablet/desktop; loading/error/empty/offline states; keyboard navigation; WCAG 2.2 AA accessibility in the main flows |
| PWA | Installation; offline app shell; update prompt; clear message when there is no connection |
| Player | Automatic engine selection; actionable error messages; PiP when supported |

### 3.2 Later version (v1.1–v1.2)
| Feature | Reason for deferring |
|---|---|
| XMLTV EPG (url-tvg / manual URL) + channel matching | Large files, complex parsing and matching; Xtream short EPG covers the essentials |
| Audio tracks and subtitles | hls.js exposes them easily; native/mpegts vary — needs per-device testing |
| Master password (app lock) | Improves security, but adds friction; optional |
| Export/import settings (file, secrets encrypted with a password) | Replaces cross-device sync without a backend |
| D-pad/TV remote navigation | Requires spatial focus management |
| Media Session (lock screen controls) | Low cost, but value depends on background playback |

### 3.3 Optional / experimental
| Feature | Note |
|---|---|
| Reference self-hosted proxy (PRX-01) | May become mandatory depending on ADR-010 |
| Capacitor Android shell (NAT-01) | Works around CORS/mixed content on Android |
| Parental control with PIN | Only a deterrent on the client side; not real security |
| Multiple profiles | Favorites/history per profile |
| Grid EPG | High UI and performance cost |
| Catch-up/timeshift | Server dependent |
| Chromecast/AirPlay/Remote Playback | AirPlay "for free" in Safari with the native engine; Cast requires an SDK and streams reachable by the receiver |
| Cross-device sync | Would require a backend or third-party storage; out of scope |

### 3.4 Out of scope (explicitly)
Preloaded lists, channel directories, DRM or DRM circumvention, recording/downloading streams, transcoding, user accounts on our infrastructure, advertising, analytics.

## 4. Non-functional requirements
| ID | Requirement | Target (measured in QA-03 / TEST_PLAN) |
|---|---|---|
| NFR-01 | Startup (repeat visit, SW active, mid-range Android) | Usable screen < 1.0 s |
| NFR-02 | First load (Lighthouse mobile) | LCP < 2.5 s; initial JS ≤ 200 KB gz |
| NFR-03 | Scrolling lists with 20 000 channels | No *long tasks* > 50 ms; ≥ 55 fps |
| NFR-04 | Search over 100 000 items | Results < 100 ms after the index is built |
| NFR-05 | Parsing an M3U with 50 000 entries | < 5 s on a mid-range Android, UI responsive |
| NFR-06 | Zapping (HLS/TS, good network, responsive server) | First frame < 3 s at p75 — **server dependent; measured, not guaranteed** |
| NFR-07 | Accessibility | 0 axe "serious/critical" violations; Lighthouse a11y ≥ 95 |
| NFR-08 | Privacy | 0 network requests to domains other than the app origin or the servers configured by the user |
| NFR-09 | Target compatibility | Chrome/Edge last 2, Firefox last 2, Safari ≥ 17.1 (iOS/macOS), current Samsung Internet |

## 5. Known limitations to communicate to the user
1. **HTTP-only** servers or servers **without CORS** may not work in the browser (see diagnostics in the app).
2. Dolby (AC-3/E-AC-3) and MP2 audio may have no sound in Chrome/Firefox.
3. MKV/AVI depend on the browser.
4. On the iPhone, fullscreen uses the native iOS controls.
5. Background playback is not guaranteed.
6. The app does not work offline for watching content (only the interface opens).
7. Credentials stay on the device; anyone with access to the unlocked device can access them.

## 6. Assumptions
- P1: The user has at least one legitimate IPTV source for testing (required for S-00).
- P2: Working name "Simple IPTV" (derived from the directory name) until the user decides.
- P3: A public GitHub repository is acceptable (a requirement of free GitHub Pages).
- P4: UI in English and pt-PT, selectable (ADR-015).
- P5: Single user per device in the MVP.
- P6: Lists stay only on the device where they were added; no sync (ADR-014, user decision).
