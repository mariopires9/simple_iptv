# Publishing and hosting

> Nothing has been published or configured. This document describes what will be done in DEP-01, **after explicit user approval**.

## 1. Decision (ADR-007 accepted on 2026-10-28)
**GitHub Pages via GitHub Actions** — the user already has a GitHub account; no new accounts are created; HTTPS and the `https://<user>.github.io/<repo>/` domain are included; limits (1 GB site, 100 GB/month soft) are far above what is needed, because video never goes through the hosting.

**Alternative:** Cloudflare Pages (or Workers static assets), if custom HTTP headers (CSP via header, `frame-ancestors`), a private repository, or a proxy on Workers are needed. Vercel and Supabase were evaluated and not recommended (see `RESEARCH.md §10.1`).

Full comparison: `RESEARCH.md §10`.

## 2. Planned configuration (DEP-01)
1. Public repository `simple_iptv` (name to be confirmed).
2. Settings › Pages › Source: **GitHub Actions**.
3. Workflow `.github/workflows/deploy.yml`:
   - Trigger: `push` on `main` (after green CI) and `workflow_dispatch`.
   - Jobs: `npm ci` → `npm run build` (with `VITE_BASE=/<repo>/`) → `actions/upload-pages-artifact` → `actions/deploy-pages`.
   - Minimal permissions: `pages: write`, `id-token: write`, `contents: read`.
   - Actions pinned by SHA.
4. `vite.config.ts`: `base: process.env.VITE_BASE ?? '/'`; manifest with `start_url`/`scope` relative to the base.
5. Router in hash mode (ADR-007) → no need for `404.html`.
6. CSP via `<meta>` (no headers on Pages).
7. E2E smoke test against the published URL (post-deploy job, read-only).

## 3. Environments
| Environment | How | Use |
|---|---|---|
| Local | `npm run dev` (http://localhost — secure context) | Development |
| Local preview | `npm run build && npm run preview` | Testing SW/PWA |
| Production | GitHub Pages | Usage |
| Per-PR previews | Not available on Pages; optional with Cloudflare Pages in the future | — |

## 4. Updates and rollback
- Each deploy is an immutable build; the SW detects a new version and asks the user to update (PWA-03).
- Rollback: `git revert` + push (new deploy) or re-run the workflow on an earlier commit.
- IndexedDB migrations must be forward-compatible; never delete user data in a migration without warning.

## 5. Costs
| Item | Cost |
|---|---|
| GitHub Pages hosting | 0 € |
| GitHub Actions (public repo) | 0 € |
| Domain | 0 € (`github.io`); optional custom domain (~10 €/year) |
| IPTV service | The user's own, independent of the app |

## 6. Platform risks
- Changes to free plans: the app is static and portable (Cloudflare Pages, Netlify, GitLab Pages) with minimal changes (`base` and workflow).
- GitHub Pages prohibits use as a commercial file/video hosting service — does not apply: we only serve the app.
