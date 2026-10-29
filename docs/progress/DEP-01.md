# DEP-01 — Deploy to GitHub Pages

**Status:** Done (2026-10-29) · coordinator · approved explicitly by the owner

## Problem found
https://mariopires9.github.io/simple_iptv/ was black: Pages was configured as "Deploy from a branch" (`build_type: legacy`, `main` /), so it served the source `index.html` (`<script type="module" src="/src/main.tsx">`) instead of the Vite build.

## Fix
- `.github/workflows/deploy.yml`: runs after a successful CI run on `main` (`workflow_run`), builds the commit CI tested with `VITE_BASE` from `configure-pages` (`/simple_iptv/`), checks `dist/index.html` (CSP, external scripts only), uploads `dist/` and deploys. Actions pinned by SHA; `concurrency: pages`.
- Pages source switched to **GitHub Actions** (`build_type: workflow`) via the GitHub API.
- No change to app code: `vite.config.ts` already reads `VITE_BASE`; the hash router needs no 404 fallback.

## Verification
- Local build with `VITE_BASE=/simple_iptv/`: every asset in `index.html`, CSS fonts and the data worker URL are under `/simple_iptv/assets/`; served locally under the sub-path, the page, 11 initial assets and the worker return 200.
- Remote: see the deploy run and the live URL (recorded in the commit/PR history).
