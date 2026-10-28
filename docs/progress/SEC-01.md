# SEC-01 — CSP, URL validation and sanitization

**Status:** Done (2026-10-28) · agent `implementer` (worktree) · review: `/code-review` + `/security-review`

## Delivered
- `build/csp.ts`: production-only CSP `<meta>` (Vite plugin, first element in `<head>`); no `unsafe-eval`, no `upgrade-insecure-requests` (would rewrite users' http:// URLs); `frame-ancestors` unavailable via meta on GitHub Pages (documented).
- `src/core/net/url.ts`: `parseExternalUrl` (http/https only, control characters rejected, credentials rejected, 8 KB limit after trimming), `displayUrl` (no userinfo/query/fragment, Xtream credential paths redacted), `safeExternalLink`.
- `eslint.config.js`: HTML-sink rules (`dangerouslySetInnerHTML`, `innerHTML`/`outerHTML`/`srcdoc` incl. computed and object-literal forms, `insertAdjacentHTML`, `document.write(ln)`, `createContextualFragment`, `setHTMLUnsafe`/`parseHTMLUnsafe`, `parseFromString` with HTML/SVG/XHTML types). Lint is defence-in-depth; variable-held keys cannot be caught statically.
- `scripts/check-dist-html.mjs`: verifies the built `dist/index.html` (CSP present and first, directives exact, no inline scripts/handlers/`javascript:`); runs in CI after the build.

## Review
- `/security-review`: no high-confidence vulnerabilities.
- `/code-review`: 9 findings, all fixed with regression tests (credentials rejected for all purposes with reason `credentials`, broader sink rules, built-output check, `.ts` import + `allowImportingTsExtensions`, trim-then-length, unreachable branch removed, `displayUrl` redaction).

## Risks
- CSP verified statically only; runtime check in a real browser (Emotion styles, hls.js/mpegts.js blob workers) is part of QA-02 / player stories.
