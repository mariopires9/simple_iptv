# FND-05 — Persistence layer (Dexie)

**Status:** Done (2026-10-28) · agent `implementer` (worktree) · review: `/code-review`

## Delivered
- `src/core/db`: schema v1 (13 tables), `openDatabase`/`closeDatabase`/`wipeAll`, `DatabaseUnavailableError`, `DatabaseClosedError`, key helpers, repositories `sourcesRepo`, `catalogRepo`, `favoritesRepo`, `historyRepo`, `settingsRepo`, `vaultStore`.
- `src/i18n/pt-PT/db.ts`: database error messages (ADR-012).

## Review
`/code-review`: 10 findings, all fixed with tests — open/close/wipe concurrency (generation counter), `historyRepo.upsert` merges instead of replacing, real pagination with the `[categoryKey+order]` index (replaces `[sourceId+categoryKey]`), `normalizeName` only strips combining marks, deduplication and real counts in `replaceForSource`, pt-PT text moved to i18n, category keys rejected as item keys, unreachable `version` branch removed.

## AC verification
| AC | Result | Evidence |
|---|---|---|
| 1. `simple-iptv` v1 database with tables and indexes | Met | test via the raw IndexedDB API |
| 2. Typed repositories; no `db.table()` in features | Met | `index.test.ts` scans `src/` |
| 3. 100k items in one transaction, old ones removed | Met | 1.7–2.8 s in Node with fake-indexeddb (not a browser measurement) |
| 4. Cascading removal | Met | test with two sources |
| 5. IndexedDB unavailable → typed error | Met | `unsupported`, `open-failed`, `timeout` |

## Risks / open items
- Wiring the error to the UI (error screen instead of a blank screen) is done in FND-04/UX-02.
- `epgPrograms` deletes by the `sourceId` index (slower); table only used post-MVP.
- Real browser performance to be measured in QA-03/DEP-02.
