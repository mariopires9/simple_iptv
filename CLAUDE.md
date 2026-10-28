# CLAUDE.md — Simple IPTV

Client-side IPTV PWA player, no backend. **Current phase: execution authorized (2026-10-28), story by story, following `docs/AGENT_WORKFLOW.md`.** Publishing (DEP-01) still requires explicit confirmation.

## Read before working
- Status and next story: `docs/BACKLOG.md` (single source of truth for status)
- Story: `docs/USER_STORIES.md` · Architecture: `docs/ARCHITECTURE.md` · Decisions: `docs/DECISIONS.md`
- Multi-agent process and serialized files: `docs/AGENT_WORKFLOW.md`

## Rules
- Do not implement anything without a story or technical justification; do not change the architecture without an ADR.
- Never store real credentials in files, fixtures, logs, prompts or commits.
- No telemetry, analytics, advertising or third-party CDN resources at runtime.
- Do not publish (GitHub Pages), create accounts or change repository visibility without approval.
- Do not bypass DRM, authentication or access restrictions; do not include third-party lists.
- All repository content is English: code, comments, docs, configs, commit messages, agent briefs.
- UI strings: `src/i18n/en/<feature>.ts` (base, defines the types) + `src/i18n/pt-PT/<feature>.ts` (ADR-015). Never hardcode user-facing text.
- Commit messages: English, imperative mood, prefixed with the story ID (e.g. `SRC-02: normalize Xtream server URL`) or a conventional type (`docs:`, `chore:`, `ci:`).
- Do not claim compatibility/performance without a recorded measurement.

## Commands
- `npm run dev` — development server (http://localhost:5173)
- `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` — mandatory gates for every story
- `npm run format` / `npm run format:check` — Prettier
- `VITE_BASE=/<repo>/ npm run build` — build for GitHub Pages

## Code conventions
- TypeScript `strict` + `noUncheckedIndexedAccess`; alias `@/` → `src/`.
- Module boundaries enforced by ESLint (`eslint.config.js`, tested in `src/test/boundaries.test.ts`); within a feature use relative imports.
- `console` forbidden outside `src/core/log`; `dangerouslySetInnerHTML` forbidden.
- Tests next to the code: `*.test.ts(x)`.
- Project agents: `.claude/agents/` (implementer, media-engineer, qa-engineer).
