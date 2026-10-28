# Simple IPTV (working title)

A free, open-source IPTV player, **with no ads and no telemetry**, that runs in the browser and installs as a PWA on Android, iOS and desktop. You connect **your own** sources (Xtream Codes or M3U/M3U8) and watch live TV, movies and series.

The UI is available in **English** and **Portuguese (pt-PT)**, selectable in Settings.

> **Status: planning complete, implementation not yet started.** There is no code and no installed dependencies yet. See `docs/IMPLEMENTATION_PLAN.md` for the next steps.

## What the app is (and is not)
- It is a **generic player**. It does not include, provide or suggest lists, channels or content.
- Use only sources you are authorized to access.
- It has no backend: your data stays on your device (credentials encrypted).
- Important limitation: IPTV servers that only work over **HTTP** or without **CORS** may not play in the browser — the app diagnoses and explains this. See `docs/RESEARCH.md §6`.

## Planned stack
React 19 + TypeScript + Vite · MUI · Dexie (IndexedDB) · hls.js + mpegts.js · vite-plugin-pwa · Vitest + Playwright · GitHub Pages.

## Documentation
| Document | Contents |
|---|---|
| [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) | Scope, MVP vs later, non-functional requirements |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Technology comparison, browser limitations, hosting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, contracts, data model, cache |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log (ADR) |
| [docs/UX_UI.md](docs/UX_UI.md) | Visual system, wireframes, flows |
| [docs/USER_STORIES.md](docs/USER_STORIES.md) | Epics and stories with acceptance criteria |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Status, dependencies and execution waves |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Milestones, sequence, risks, assumptions |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Test strategy and metrics |
| [docs/SECURITY.md](docs/SECURITY.md) | Security, privacy and legal limits |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Free publishing |
| [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md) | Orchestration with Claude Code |

## Installation and running (after FND-01)
```bash
npm ci
npm run dev        # development at http://localhost:5173
npm test           # unit tests
npm run e2e        # E2E tests (Playwright)
npm run build      # production build in dist/
```
Requires Node 24 (see `.nvmrc`, to be created).

## License
To be defined by the author (suggestion: MIT). Planned dependencies: MIT / Apache-2.0 / ISC / OFL.
