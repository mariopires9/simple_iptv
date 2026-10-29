# TEC-02 — Extract shared feature helpers into `src/ui`

**Status:** Done (2026-10-29) · agent `implementer` (worktree) · review: `/code-review`

## Delivered
Shared catalogue helpers moved out of Live/Movies into `src/ui` (`catalog/pageCache` `CatalogPageCache`, `CategoryNav`, image/poster helpers, colour hash, `hooks/useActiveSource`) and the extension/container map into `@/player/containers`. Behaviour unchanged; the old tests were moved with the code (eviction, pins, in-flight, missing key, 4.5:1 contrast).

## Review
`/code-review` (medium): 7 findings, no regressions.
- Fixed: `mts`/`m2ts` added to the shared container map (it now matches the M3U parser); `containerOf` trims before it strips the dot, with tests that pin the new `mpegts`/`m2ts`/`wav`/`opus` results; redundant `setViewport(active, active)` removed from `ChannelList` (the pin already loads that page); the pinned set is built once per `evict()`; `features/sources/activeSource` re-exports `@/ui/hooks/useActiveSource` instead of keeping a copy.
- Deferred (would change shared APIs that Series/Home are being built on): typed `favorite`/`icon` on `NavCategory` instead of `kind === 'favorites'`; the duplicate `pager` field in Live's `PageCache` subclass.
