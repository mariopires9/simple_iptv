# FND-07 — Web Worker infrastructure

**Status:** Done (2026-10-28) · agent `implementer` (worktree) · review: `/code-review`

## Delivered
- `src/core/worker`: `createDataWorkerApi`, `data.worker.ts`, client `getDataWorker`/`runTask`/`terminateDataWorker`, `WorkerTaskError` (`cancelled`|`failed`), task registry with derived types, demo task `selfTest`.
- Progress throttled to 50 ms over a dedicated `MessageChannel` (port closed on all paths); immediate cancellation via `AbortSignal`.
- `vite.config.ts`: `worker.format: 'es'` (coordinator).

## Review
- `/code-review`: 9 findings; 7 fixed with tests (only `WorkerTaskError` messages cross the boundary; worker errors/death reject pending calls and recreate the worker; abort rejects immediately; aborted→ok ordering; port leaks; flush with timeout; `AbortError` → `cancelled`).
- Not fixed, justified: messages are diagnostic (the UI maps `kind` to strings from `src/i18n`); unanswered proxy RELEASE is harmless.

## AC verification
| AC | Result | Evidence |
|---|---|---|
| 1. Comlink with progress and cancellation | Met | `worker.test.ts` (27 tests, real MessageChannel) |
| 2. Errors with `kind`, no sensitive data | Met | envelope tests (only `name/kind/message`) |
| 3. Separate chunk in production | Met | build with a temporary import: `data.worker-*.js 6.28 kB` (ES format) |

## Risks
- Cooperative cancellation: tasks that do not call `throwIfCancelled()` delay subsequent ones in the single worker.
