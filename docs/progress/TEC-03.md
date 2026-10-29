# TEC-03 — Review follow-ups

**Status:** Done (2026-10-29) · agent `implementer` (worktree) · review: `/code-review`

## Delivered
- Shared Live routes in `src/ui/routes/live.ts` (`LIVE_VIRTUAL_CATEGORY_IDS`, `LIVE_RECENT_LIMIT`, `liveCategoryPath`, `liveChannelPath`, `liveChannelSearch`) used by Live, Home and Search; no aliases left.
- `NavCategory.favorite?: boolean` instead of `kind === 'favorites'` in the shared CategoryNav; Live `PageCache` reads the base-class `source`.
- One "player open" signal: the PlayerView wrapper holds `claimPlayback()` (covers strings loading); i18n's locale switch receives it from `App.tsx` (`installLanguagePreference(isPlaybackActive, subscribePlayback)`); `holdLocaleSwitch` removed.
- Resume rules: grid bars = any started, not completed item (VOD-01 AC4, unchanged); Home "Continue watching" = `continueWatchingProgress` (worth resuming); series shown at ≥ 60 s not completed, or on the next-episode pointer.
- Flaky tests made deterministic (FavoritesScreen, PlaybackSection, ChannelList.epg, XtreamSourceForm) and `cleanup()` first in 12 screen test files (file-level `afterEach` runs before the setup file's).

## Review
`/code-review` (medium): 7 findings, all addressed (signal reset, wrapper-level claim, grid bars reverted, series rule, `liveChannelSearch`, aliases removed; backlog entry added by the coordinator).
Open: intermittent undici `assert(!this.aborted)` from `M3uUrlForm.test.tsx` under heavy load; optional global fix `test.sequence.hooks: 'list'` (vite.config) not applied.
