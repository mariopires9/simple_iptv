# TEC-01 — Load feature strings with their feature

**Status:** Done (2026-10-29) · agent `implementer` (worktree) · review: `/code-review`

## Delivered
Eager/lazy i18n namespaces with a registry (`ensureMessages`, `setLocale`, dev guard / production fallback), `lazyScreen(load, name, namespaces)` loading screen chunk and strings in parallel (retry-safe), eager `lists` namespace for the top-bar selector, `player` strings loaded with `@/player/ui`, `@/i18n/catalogs` restricted to tests (ESLint). Rules recorded in DECISIONS.md (ADR-015 implementation notes).

## Measurements
Initial JS (gzip, entry static closure): 193.9 → 185.8 KiB. Feature string chunks: 10 dynamic chunks, ~15 KiB gzip in total.

## Review
`/code-review`: 10 findings; 7 fixed with tests; 2 deferred (per-feature screen wrapper, glob-generated loaders); 1 kept by design (global string preload in tests — `routeStrings.test.tsx` renders every route with feature strings unloaded).
