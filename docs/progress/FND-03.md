# FND-03 — Design tokens, theme and AppShell

**Status:** Done (2026-10-28) · agent `implementer` (worktree) · review: `/code-review` · visual checkpoint: pending owner feedback

## Delivered
- `src/ui/theme`: tokens (both palettes, typography, radii, motion, breakpoints), `createAppTheme` (no shadows, ripple off, 44 px targets, visible focus ring, reduced motion), `ThemeModeProvider` (System/Dark/Light persisted in IndexedDB, mirrored to localStorage to avoid a flash on cold start), WCAG contrast helpers.
- `src/app/AppShell.tsx` + `src/app/shell/*`: bottom navigation (< 600 px, sticky, safe-area aware), navigation rail (600–1199 px), expanded rail (≥ 1200 px), top bar with theme menu. Selection is local state until FND-04 (routing).
- `src/i18n/{en,pt-PT}/nav.ts`.

## Token changes (light theme, to pass WCAG on every surface)
accent/focus ring `#0A7A5E` → `#087258`; live `#D62F35` → `#BF2A2F`; warning `#9A6400` → `#8A5A00`; danger `#C62828` → `#BE2626`. `docs/UX_UI.md §2.1` updated.

## Review
`/code-review`: 10 findings + 3 minor, all fixed (theme flash, measured/sticky bottom bar, auto-height duration, stronger colour-literal scan, labelled theme radio group, spy restore, single reduced-motion source, responsive padding, dead tokens, single THEMES tuple, `@/ui` exports, consistent `noSsr`, Settings selection on mobile).
After merge, the colour-literal scan was limited to non-test files (a URL fragment `#abc123` in a SEC-01 test was a false positive).

## Measurements
- Initial JS: 166.22 KB gzip (ADR-003 trigger is 200 KB). Vite warns about a > 500 KB minified chunk; route-level `lazy()` in FND-04 should split it.

## Risks
- Only verified in jsdom; visual check in a real browser at the checkpoint and in QA-02.
