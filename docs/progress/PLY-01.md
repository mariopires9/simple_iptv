# PLY-01 — Playback core and engine selection

**Status:** Done (2026-10-28) · agent `media-engineer` (worktree) · review: `/code-review`

## Delivered
- `src/core/platform/capabilities.ts`: feature detection (MSE, ManagedMediaSource, native HLS, codecs, PiP, fullscreen); UA used only for Safari/iOS (documented).
- `src/player`: `selectEngine`/`planPlayback`, native / hls.js / mpegts.js engines (libraries loaded with `import()` on first use), `createPlayerController` (fallbacks once each, abort on rapid zapping, `skipped`/`fallback`/`notice`/`error` events, never rejects), error mapping to `PlaybackErrorKind`.
- hls.js requests go through a rewriting loader: proxy rewriting keeps relative URIs resolving against the original playlist. Bounded media-error recovery (3 per 60 s, progress required between). `startAt` only for VOD; mpegts/native emit `resume-unsupported` when the position is not seekable.
- mpegts.js console logging disabled and forwarded through the redacting logger.

## Measurements
Initial JS unchanged (≈ 173–178 KB gz). Lazy chunks: player ≈ 7 KB gz, hls.js ≈ 179 KB gz (ADR-017), mpegts.js ≈ 62 KB gz.

## CSP
No change needed: hls.js and mpegts.js workers use `blob:` (allowed); no `eval`. mpegts.js worker left disabled until verified in a real browser (QA-02).

## Review
`/code-review`: 9 findings, all fixed with tests.

## Open
- Real-browser playback (QA-02), iPhone MMS, AC-3/MP2 audio, MKV on Chrome: unverified.
- Follow-up: export `pageProtocol` from `@/core/net` and remove the copy in `src/player/errors.ts`.
