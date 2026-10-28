# FND-04 — Routing and screen skeleton

**Status:** Done (2026-10-28) · agent `implementer` (worktree) · review: `/code-review`

## Delivered
- Hash router (react-router 8, `createHashRouter`, module-level singleton) with all MVP routes; features register their own routes (`src/features/*/routes.tsx`) via `lazyScreen()` (function-form lazy, one chunk per screen); shared `PlaceholderScreen`.
- Not-found screen; per-route error boundary (friendly message, "Try again", "Go to Home"; chunk-load failures after a redeploy trigger a guarded full reload; `vite:preloadError` handled).
- Nav items are `NavLink`s; current item follows the route (case-insensitive); `ScrollRestoration`; `/movies|series|live/category` without id redirect to the list.
- Startup DB check before mounting the router (no teardown of a running app); full-screen "storage unavailable" message using `t.db.errors[reason]`.
- i18n message functions (`categoryLabel(id)`, `itemLabel(id)`) with type-checked completeness.

## Bundle (initial JS, gzip)
react 68.3 · mui 62.3 · router 31.8 · app 10.2 · runtime 0.4 → **≈ 173 KB** (budget 200 KB). Dexie (32 KB) is a separate chunk loaded by the startup DB check; it is on the first-paint path, which QA-03 (Lighthouse) will measure.

## Review
`/code-review`: 10 findings + coordinator budget item, all fixed with tests.
