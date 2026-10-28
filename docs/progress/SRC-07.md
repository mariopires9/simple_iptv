# SRC-07 — Sync the Xtream catalog

**Status:** Done (2026-10-28) · agent `media-engineer` (worktree) · review: `/code-review` + `/security-review`

## Delivered
- `src/providers/xtream/catalog.ts` (tolerant per-item schemas + mappers; image URLs validated and credential-free; `streamPath` = id or `id.ext`, never full URLs) and `sync.ts` (`syncXtreamSource`).
- `src/worker/` composition root (ADR-016): task registry (`selfTest`, `syncXtream`, `waitSyncIdle`), worker entry, typed client, `isSyncDue` / `startBackgroundSyncIfDue`. `src/core/worker` is now a generic runtime.
- Password read from the vault inside the worker (never crosses postMessage); worker-side redaction.
- Writes guarded by a source-existence check in the same transaction (`replaceForExistingSource`); per-source sync queue; per-type outcome (`lastSyncByType`); `[]` only replaces data on first sync or when categories are also empty; fatal errors don't advance `lastSyncAt`; after auth, the first network/timeout failure stops the remaining types (`server-unreachable`); categories timeout 30 s, items 120 s.

## Measurements (Node, fake-indexeddb)
50 000 VOD items (15.3 MB JSON): ~1–3.4 s, heap +~100 MB. Not a browser/weak-device number.

## Review
- `/security-review`: no vulnerabilities.
- `/code-review`: 9 findings; 8 fixed with tests; 1 (docs/ADR) already covered by ADR-016.
- After merge, a cancel/restart test was flaky under coverage (the sync finished before the abort landed); its simulated panel delay was raised to 300 ms (5/5 coverage runs green).

## Risks
- Memory on weak devices for very large catalogues (plan B: per-category loading).
- Syncs from two tabs are not serialised (transaction guard still prevents orphans).
- Worker log entries live in the worker's own buffer (not in the main-thread diagnostics export yet).
