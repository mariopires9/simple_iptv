# SRC-09, PWA-04 — Compatibility diagnostics and offline state

**Status:** Done (2026-10-29) · agent `media-engineer` (worktree) · reviews: `/code-review`, security review

## Delivered
- SRC-09: per-list Diagnostics (My lists card action, `/settings/sources/diagnostics[/:sourceId]`): HTTPS, API access (CORS) via the existing clients, live format, browser support (MSE, ManagedMediaSource, native HLS), codecs (H.264, HEVC, AAC, AC-3, E-AC-3). Each failure has an explanation and actions (HTTPS, local file, Safari, per-list live format switch, check details/credentials, future personal proxy — not promised). "Copy report" has no credentials, list name or full host (masked, then redacted); clipboard fallback textbox.
- PWA-04: connectivity store in `@/core/net` — `offline` from the browser; `unreachable` only when a provider timeout/TypeError is followed by a failed same-origin `HEAD` probe of the app base (precache can't answer it); clears only on success, re-probes with backoff. Banner in the top bar and full-screen layout; Refresh/Add list blocked offline (file import allowed); player records the offline cause at failure, doesn't burn live reconnects while offline and retries once on recovery. Never promises offline playback.
- SRC-07 AC5 wired: background sync of lists older than 24 h on app open (idle, lazy) and once per real recovery, through the My lists sync tracker, with a small sync indicator next to the list selector.

## Measurements
Initial JS (gzip): 187.0 → 189.2 KiB (connectivity store, banner, strings; diagnostics and startup sync lazy).

## Review
`/code-review` (medium): 10 findings, all addressed (probe-based unreachable, no blind timer, recovery-only resume, startup sync, per-list live format, invalid-address code, player offline handling, comment order; the SourceCard kind check stays — file lists refresh offline). Security review: no findings.
Not verified on devices: codec probes (`isTypeSupported`/`canPlayType`) — no compatibility claimed. Data-worker requests don't feed the connectivity store.
