# Technical research and browser limitations

> Planning phase 1. Research date: 2026-10-28.
> Versions confirmed on the npm registry on this date (they are a reference, not a commitment; they will be pinned in `package-lock.json` in story FND-01).

| Package | Current version | License | Intended use |
|---|---|---|---|
| react | 19.3.1 | MIT | UI |
| vite | 8.3.5 | MIT | build/dev server |
| vite-plugin-pwa | 2.0.0 | MIT | manifest + service worker (Workbox) |
| @mui/material | 9.5.0 | MIT | components |
| react-router | 8.5.1 | MIT | routing |
| dexie | 4.4.7 | Apache-2.0 | IndexedDB |
| zustand | 5.0.16 | MIT | UI state |
| @tanstack/react-query | 5.105.0 | MIT | remote request cache |
| @tanstack/react-virtual | 3.14.23 | MIT | virtualized lists |
| hls.js | 1.7.3 | Apache-2.0 | HLS via MSE/MMS |
| mpegts.js | 1.8.2 | Apache-2.0 | MPEG-TS/FLV via MSE/MMS |
| minisearch | 7.2.0 | MIT | search index |
| vitest | 5.0.5 | MIT | unit tests |
| @playwright/test | 1.64.1 | Apache-2.0 | E2E |

Verified directly in the published code: **hls.js 1.7.3 and mpegts.js 1.8.2 contain code paths for `ManagedMediaSource`** (the Safari 17.1+ API that replaces MSE on the iPhone). This makes MSE-based playback *possible* on the iPhone, but it is **not validated on a device** — it is an item of spike S-00.

---

## 1. Current environment (Phase 0)

| Item | Status |
|---|---|
| Directory `/home/academy/projects/simple_iptv` | Empty; not a git repository |
| Project CLAUDE.md / `.claude/` | Do not exist |
| Custom agents | None (only the built-in ones: general-purpose, Explore, Plan) |
| Useful skills available | `code-review`, `security-review`, `simplify`, `run`, `init` |
| Useful MCPs | None relevant to the project (the existing ones are for enterprise productivity) |
| Node / npm | v24.18.0 / 11.16.0 |
| git / gh | 2.43.0 / 2.45.0 — **`gh` not authenticated** |
| Browsers for E2E | None installed (Playwright will have to download Chromium/WebKit/Firefox at run time) |
| Docker | Unavailable |
| OS | Linux (WSL2) |

Consequences: *greenfield* project; no conventions to inherit; the agent workflow must use only what exists (see `AGENT_WORKFLOW.md`); tests on WebKit (as a proxy for Safari) are possible via Playwright, but **do not replace testing on a real iPhone**.

---

## 2. Frameworks

| Criterion | React + TS + Vite (SPA) | Next.js (static export or SSR) |
|---|---|---|
| Cost | €0 — static files | €0 with static export; SSR requires a runtime (Vercel/Workers) |
| Performance | Excellent; per-route code-splitting; no hydration | SSR/RSC brings no gain: content depends on local credentials and is not indexable |
| Complexity | Low | Higher (RSC, server/client boundaries, `output: 'export'` loses features) |
| Maintenance | Simple | More disruptive upgrades |
| Security | Credentials never leave the browser | A server would invite using API routes as a proxy → it would start handling credentials |
| No backend | Natural | Goes against the grain |
| PWA | Mature `vite-plugin-pwa` | Possible but less direct |

**Conclusion:** React + TypeScript + Vite. Next.js has no concrete advantage for a client-side player whose content is private and per user.

## 3. Component library

| Criterion | MUI (Material UI) v9 | Radix Primitives + Tailwind (shadcn style) | Mantine |
|---|---|---|---|
| Coverage (lists, tabs, dialogs, nav, snackbars, sliders) | Complete | Primitives; many components hand-built | Complete |
| Accessibility | Good, tested | Very good (primitives) | Good |
| Own identity | Needs a strong theme to not look "Material" | Full | Medium |
| Weight | Larger (Emotion runtime) — mitigable with path imports | Smaller | Medium |
| Delivery speed | High | Medium | High |

**Recommendation:** MUI with a custom theme (own tokens, no overdone *ripple*, no Material shadows, tonal surfaces). Alternative: Radix + Tailwind, if the bundle budget (≤ 200 KB gz initial) cannot be met with MUI — the criterion lives in QA-03.

## 4. Local persistence

| Option | Pros | Cons | Decision |
|---|---|---|---|
| `localStorage` | Simple | Synchronous, ~5 MB, strings only | Only trivial preferences? No — everything in IndexedDB to have a single "delete data" point |
| IndexedDB via `idb` | Thin (~1 KB) | Indexes, migrations and bulk by hand | Alternative |
| **IndexedDB via Dexie** | Compound indexes, fast `bulkPut`, versioned migrations, `liveQuery` | ~25 KB gz | **Chosen**: catalogs of 10k–100k+ items need bulk operations and indexes |
| OPFS | Fast for blobs | Not a database | Not needed |

Notes: Safari deletes storage of **non-installed** sites after 7 days without interaction; apps added to the home screen are exempt. Request `navigator.storage.persist()` after the first source.

## 5. Video playback

### 5.1 Typical IPTV provider formats

| Content | Usual format | Browser engine |
|---|---|---|
| Live (Xtream) | `/live/u/p/ID.ts` (continuous MPEG-TS) or `.m3u8` if the panel allows it | mpegts.js (TS) or hls.js/native (HLS) |
| Live (generic M3U) | HLS `.m3u8` or TS | same |
| VOD | `.mp4`, `.mkv`, sometimes `.avi` | native `<video>` |
| Series | same as VOD | same |

### 5.2 Engines

| Engine | Supports | Requirements | Limitations |
|---|---|---|---|
| Native `<video>` | MP4/WebM everywhere; native HLS on Safari (macOS/iOS) and recent Chrome Android | No CORS for simple playback | No raw TS; MKV only "de facto" in Chrome |
| hls.js | HLS in browsers with MSE/MMS | **CORS** on playlists and segments (uses fetch/XHR) | Codec still depends on the device |
| mpegts.js | Live MPEG-TS and FLV via MSE/MMS | **CORS** + streaming fetch | MP2/AC-3 audio often not supported by MSE (to be validated) |
| Shaka / Video.js | DASH, DRM | — | DASH/DRM out of scope; Video.js would add weight with no gain |

**Selection rule (to be implemented in PLY-01):**
1. HLS on Safari/iOS → native first (no CORS required, AirPlay, better battery); otherwise hls.js.
2. TS → mpegts.js if `isSupported()`; otherwise, for Xtream, try the `.m3u8` variant if `allowed_output_formats` includes it.
3. MP4/WebM/MOV → native. MKV → native with a clear message on failure. AVI and others → "format not supported by the browser".

### 5.3 Codecs (device dependent — **not guaranteed**)

| Codec | Chrome/Edge | Firefox | Safari |
|---|---|---|---|
| H.264 + AAC | Yes | Yes | Yes |
| HEVC/H.265 | Only with hardware decoding | Limited | Yes |
| AC-3 / E-AC-3 (Dolby) | No (Chrome); Edge depends on the OS | No | Yes |
| MP2 (common in DVB) | Not via MSE | No | No |

Consequence: channels with AC-3/MP2 audio may play **video without sound** in Chrome. The app must detect this via `MediaSource.isTypeSupported`/error events and inform the user; it cannot be fixed without transcoding (out of scope).

## 6. Critical browser constraints (the deciding factor)

### 6.1 Mixed content
A PWA **must** be served over HTTPS (the service worker requires a secure context). Most Xtream/IPTV servers serve **HTTP only**. On an HTTPS page:
- `fetch`/XHR to `http://` → **blocked** (Xtream API, HLS playlists via hls.js, mpegts.js).
- `<video src="http://...">` → Chrome/Firefox *auto-upgrade* to `https://`; if the server has no HTTPS, it **fails**.
- `http://` images (logos/posters) → auto-upgrade; they fail without HTTPS → show a fallback.

### 6.2 CORS
Even with HTTPS, the server must return `Access-Control-Allow-Origin` for: `player_api.php`, M3U download by URL, XMLTV, HLS playlists and segments (hls.js), TS streams (mpegts.js). Many panels do not. **Exceptions:** direct playback in `<video>` (MP4, Safari native HLS) and importing a local M3U file.

### 6.3 Others
| Topic | Reality |
|---|---|
| Headers | The browser **does not allow setting `User-Agent`** or arbitrary `Referer`; providers that require a specific UA will not work |
| Redirects | Xtream streams redirect (302) to other hosts; CORS and HTTPS also apply to the target |
| Autoplay | With sound only after a user gesture; zapping by tap/key counts as a gesture |
| Fullscreen | iPhone: only `webkitEnterFullscreen()` on the `<video>` (native controls, our own overlay is lost); iPad/Android/desktop: Fullscreen API |
| Background | Video pauses or is suspended when the app loses focus on iOS; do not promise background audio. PiP available in Safari and Chrome |
| Local network | Chrome 141/142+ requires the *Local Network Access* permission for requests from public sites to private IPs (relevant for a home proxy) |
| SW cache | *Opaque* responses (images without CORS) take ~7 MB of quota each in Chrome → do **not** cache opaque images in the SW |
| DRM | Out of scope; the app neither circumvents nor implements DRM |
| Catch-up/timeshift | Server dependent; post-MVP |

### 6.4 Options for HTTP-only or no-CORS servers

| Option | Cost | Pros | Cons |
|---|---|---|---|
| A. "Direct mode" only (accept the limitation) | 0 | Simple, no third parties | May not work with the user's provider |
| B. Proxy hosted on Cloudflare Workers | 0 (100k requests/day) | Quick to set up | Cloudflare terms restrict video outside Stream/R2; each segment counts as a request; the proxy sees credentials |
| C. Proxy self-hosted by the user (Node/Deno on PC/RPi/VPS) exposed over HTTPS (e.g. Tailscale Serve/Funnel, own certificate) | 0 at home | Full control, no third parties | Requires technical setup |
| D. Native Android shell (Capacitor) with cleartext + native HTTP | 0 (sideload); 25 USD Play Store | Solves CORS and mixed content on Android | iOS requires 99 USD/year; no longer "browser only" |

**Recommendation:** MVP with A + clear diagnostics; `UrlRewriter` contract prepared for C; D as an architectural alternative. **The final decision depends on spike S-00 with the user's real provider** (ADR-010, pending).

## 7. Xtream Codes API (endpoints used)

| Request | Use |
|---|---|
| `player_api.php?username&password` | Authentication; `user_info` (status, exp_date, max_connections, allowed_output_formats) and `server_info` (url, https_port, server_protocol) |
| `&action=get_live_categories` / `get_live_streams[&category_id]` | Live |
| `&action=get_vod_categories` / `get_vod_streams` / `get_vod_info&vod_id` | Movies |
| `&action=get_series_categories` / `get_series` / `get_series_info&series_id` | Series/seasons/episodes |
| `&action=get_short_epg&stream_id&limit` | Now/next (titles in base64) |
| `xmltv.php?username&password` | Full EPG (can be tens of MB) |
| Stream URLs | `{base}/live/{u}/{p}/{id}.{ts|m3u8}`, `{base}/movie/{u}/{p}/{id}.{ext}`, `{base}/series/{u}/{p}/{id}.{ext}` |

Notes: it is not a standardized API — variations between panels (XUI.one, etc.), missing fields, numbers as strings. The client must validate defensively (tolerant schemas). `server_info.https_port` allows trying HTTPS automatically.

## 8. M3U/M3U8
- `#EXTM3U [url-tvg|x-tvg-url="..."]`, `#EXTINF:-1 tvg-id tvg-name tvg-logo group-title tvg-chno catchup...,Name`, `#EXTVLCOPT`, `#KODIPROP` (ignored or read only).
- Lists of 50k–200k lines are common → parse in a Web Worker, streaming, with progress.
- `get.php?username=..&password=..&type=m3u_plus` URLs indicate an Xtream server → suggest converting to an Xtream source (better performance and metadata).

## 9. EPG
- XMLTV may be `.xml.gz`: `DecompressionStream('gzip')` is native in modern browsers.
- Streaming (SAX) parse in a worker; keep only a window from −2h to +24/48h.
- Matching: `tvg-id` ↔ `channel@id`; fallback by normalized name (lowercase, no accents, no HD/FHD/"PT:" suffixes). Imperfect matching is unavoidable and must be documented in the UI.

## 10. Free hosting

| Platform | Git deploy | HTTPS + domain | Relevant limits | Custom headers | SPA fallback | Risks |
|---|---|---|---|---|---|---|
| **GitHub Pages** | Yes (Actions) | `*.github.io` | 1 GB site; 100 GB/month soft; 10 builds/h (does not apply to Actions) | No (CSP only via `<meta>`) | No (use HashRouter or `404.html`) | Repo must be **public** on the Free plan |
| Cloudflare Pages | Yes | `*.pages.dev` | 500 builds/month; unlimited static requests | Yes (`_headers`) | Yes | Investment shifted to Workers static assets; requires a new account |
| Cloudflare Workers (static assets) | Yes | `*.workers.dev` | Static assets not metered | Yes | Yes | New account; more configuration |
| Netlify | Yes | `*.netlify.app` | Credit-based free plan (changed in 2025) | Yes | Yes | Frequent plan changes |
| Vercel Hobby | Yes | `*.vercel.app` | **Non-commercial** use | Yes | Yes | Hobby terms |

Video traffic **never** goes through the host (the app only serves ~1–2 MB of static files), so bandwidth limits are irrelevant in practice.

**Recommendation:** GitHub Pages (account already exists, zero new accounts, Actions). Alternative: Cloudflare Pages/Workers if HTTP headers are needed (CSP `frame-ancestors`, etc.) or if the option B proxy is adopted.

### 10.1 Do Vercel and Supabase make sense?

| Service | What it would be for | Assessment |
|---|---|---|
| **Vercel** (Hobby) | Hosting the SPA; Functions as a proxy | Hosting the SPA works, but adds nothing over GitHub Pages for a static app, and the Hobby plan is **for non-commercial use only**. Using Functions/Edge as a video proxy does not work: free-plan bandwidth is limited, functions have duration limits and IPTV credentials would pass through third-party infrastructure. **Not recommended.** It would be an acceptable alternative to Cloudflare Pages if HTTP headers were needed. |
| **Supabase** (Free) | Postgres/Auth/Storage to sync across devices; Edge Functions as a proxy | It is a backend: it contradicts ADR-001 without a concrete need in the MVP. Storing IPTV credentials in a third-party database worsens privacy. Free projects are paused after inactivity, and Edge Functions have the same video-proxy problems. **Not recommended for the MVP.** If cross-device sync is ever requested, Supabase is the candidate to evaluate (with secrets encrypted on the client by a user password, end-to-end), but EXP-01 (file export/import) covers the need without a backend. |

## Sources consulted
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Cloudflare — delivering videos with Cloudflare](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/delivering-videos-with-cloudflare/index.md)
- [Cloudflare Pages vs Workers 2026 (morphllm)](https://www.morphllm.com/comparisons/cloudflare-pages-vs-workers), [Cloudflare free limits (eastondev)](https://eastondev.com/blog/en/posts/dev/20260526-cloudflare-free-limits/)
- [Chrome — Local Network Access](https://developer.chrome.com/blog/local-network-access)
- [Safari 17.1 Managed Media Source (Radiant)](https://payment.radiantmediaplayer.com/blog/at-last-safari-17.1-now-brings-the-new-managed-media-source-api-to-iphone.html), [Bitmovin — MMS](https://community.bitmovin.com/t/everything-you-need-to-know-about-apple-s-new-managed-media-source/2076)
- npm registry (versions and licenses), inspection of the `hls.js@1.7.3` and `mpegts.js@1.8.2` packages
