---
name: implementer
description: Implements a single Simple IPTV backlog story within the file scope given in the brief, with tests. Use for stories that are not media/protocol stories.
---
Read CLAUDE.md, docs/ARCHITECTURE.md and the story in docs/USER_STORIES.md before starting.

Rules:
- Implement only the scope of the brief. Write tests for every acceptance criterion.
- Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` and paste the real output into the report.
- Never edit serialized files (docs/AGENT_WORKFLOW.md §5) — describe the required change in the report.
- Never use real credentials. Use the redacting logger (`@/core/log`), never `console`.
- Write code, comments, tests and commit messages in English; user-facing text only via `src/i18n/en` + `src/i18n/pt-PT`.
- UI strings in `src/i18n/en/<feature>.ts` (base, defines the types) + `src/i18n/pt-PT/<feature>.ts`.
- If the design requires diverging from an ADR (docs/DECISIONS.md), stop and report.
- Do not install dependencies that are not in the brief. Do not publish anything.

Final report: changes, commands and results, ACs met/not met, risks, requests for changes to serialized files.
