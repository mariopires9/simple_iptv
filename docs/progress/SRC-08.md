# SRC-08 — "My lists" page and active list switcher

**Status:** Done (2026-10-29) · agent `implementer` (worktree) · review: `/code-review` · requested by the owner after testing an M3U list

## Delivered
- `/settings/sources` "My lists": cards (name, type, counts, relative last sync, status with reason, ACTIVE), Use this, Refresh (worker task by type, progress, cancel), Edit (rename; Xtream server/credentials re-tested before saving, re-sync afterwards), Remove (confirmation; cancels syncs, cascade delete, vault secret, next active list or onboarding).
- Top-bar list selector (active list name, radio menu, "Manage lists…", "Add list" chooser); Settings links to My lists and Privacy.
- `core/session/activeSource` store (framework-agnostic, lazy DB) — screens subscribe and reload their data on change; no remount of the shell content.

## Review
`/code-review`: 10 findings, all fixed with tests (design change: session store instead of remounting `<main>`).

## Open
- Xtream account expiry not stored on the source yet (card omits it).
- Background sync (`startBackgroundSyncIfDue`) not wired into the app yet.
