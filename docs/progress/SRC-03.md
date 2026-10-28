# UX-01 + SRC-03 — Onboarding and add Xtream source

**Status:** Done (2026-10-28) · agent `implementer` (worktree) · review: `/code-review`

## Delivered
- Onboarding guard (shell stays visible while checking; no sources → `/onboarding`, Settings exempt; retries after a failed check), onboarding screen (Xtream recommended; M3U options as placeholders), privacy placeholder.
- Xtream form: per-field validation and focus, test steps with cancel, account info (Intl dates), problems + fixes, "Save anyway" for mixed content, vault-encrypted password, source row, `onboardingDone`/`activeSourceId`, initial sync through the `syncXtream` worker task (honest toast), destination depends on entry point.

## Review
`/code-review`: 9 findings, all fixed with tests.

## First real test (owner's provider, 2026-10-28)
The form reported "blocked (cors)". Diagnosis from the shell: the host the owner entered has no public DNS record (parent domain resolves) → wrong/changed server address, not a CORS verdict yet. See `S-00.md`.
