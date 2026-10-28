# FND-06 — Redacting logger and error model

**Status:** Done (2026-10-28) · agent `implementer` (worktree) · review: `/code-review` + `/security-review`

## Delivered
- `src/core/log`: `redact`, `registerSecret`/`unregisterSecret`/`clearSecrets`, `log.*`, ring buffer of 500, `exportDiagnostics`, `toLogJson`.
- `src/core/net/errors.ts`: `NetError` (`kind`, `status`, `hint`, shortened and redacted `target`), `isNetError`, `shortenUrl`.

## Review
- `/security-review`: no high-confidence vulnerabilities.
- `/code-review`: 10 findings; 9 fixed with regression tests (camelCase keys and `Authorization`, form-urlencoded form of secrets, Xtream paths without prefix `/<u>/<p>/<id>.ts`, `shortenUrl` only keeps known segments, non-string JSON values, cycles in `Error`, shared references, redacted `cause` chain, unredacted report header). Not fixed: O(n) cost of `splice` in the 500-entry buffer (negligible).

## Known limitations
- Credentials are only guaranteed to be removed if registered (`registerSecret`) — SRC-01/SRC-02 must register them on load.
- `Basic <b64>` without a preceding `Authorization:` and uppercase names without a separator (`APIKEY`) are not masked by default.
- Performance tests with a 250 ms limit may be flaky on slow CI.

## Evidence
Gates on `main` after merge: lint 0, typecheck 0, 138 tests, build ok.
