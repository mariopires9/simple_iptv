# SRC-02 — Xtream client: authentication and account

**Status:** Done (2026-10-28) · agent `media-engineer` (worktree) · review: `/code-review` + `/security-review`

## Delivered
- `src/core/net/http.ts`: `fetchJson`/`fetchText` (timeout incl. body, caller abort, `UrlRewriter` hook, `credentials: 'omit'`, `no-referrer`, error classification into `NetError`, redacted cause chain, unread bodies drained/cancelled).
- `src/providers/xtream`: `normalizeServerUrl`, tolerant Valibot schemas, `createXtreamClient` (`authenticate`, `call`), `testConnection` → `XtreamConnectionReport` (`account`, `problems[]` with codes/fix codes, `baseUrl`, `https`, `httpsCheck`, `httpsAttempts`).
- HTTPS handling: after HTTP success, probes `https_port` (skipped for inactive accounts); when HTTP is blocked as mixed content, probes `https://host:<same port>` then `https://host` — credentials only to the host the user entered; short per-probe timeout (5 s).
- JSON served as `text/html` (common on PHP panels) is accepted.

## Review
- `/security-review`: no vulnerabilities.
- `/code-review`: 10 findings, all fixed with tests.

## Open points
- ARCHITECTURE §4 report shape now includes `baseUrl`, `httpsCheck`, `httpsAttempts`, `fixes`; `ConnectionReport` types live in `src/providers/xtream/types.ts` until the M3U provider needs a shared module.
- Only verified against the synthetic MSW panel; real-provider behaviour comes from S-00.
