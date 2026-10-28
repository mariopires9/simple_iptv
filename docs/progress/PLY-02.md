# PLY-02 — Player UI and controls

**Status:** Done (2026-10-28) · agent `media-engineer` (worktree) · review: `/code-review`

## Delivered
`src/player/ui`: `PlayerView` (owns `<video>`, `playsInline`, no `crossOrigin`), controls (Live indicator, DVR window + safe "Go live", VOD progress ±10 s), auto-hide (3 s; not while hovering/keyboard focus/menus), shortcuts (no auto-repeat except seek), delayed buffering spinner (500 ms), polite announcements, muted-autoplay fallback with Unmute, minimal error overlay (full mapping in PLY-04). Loaded only via `import('@/player/ui')`.

## Review
`/code-review`: 10 findings, all fixed with tests.

## Open
Real-browser/iOS autoplay and `playsInline` behaviour (DEP-02); fullscreen/PiP (PLY-03).
