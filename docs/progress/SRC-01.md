# SRC-01 — Credential vault

**Status:** Done (2026-10-28) · agent `implementer` (worktree) · review: `/code-review` + `/security-review`

## Delivered
- `src/core/crypto/vault.ts`: `CredentialVault` (`put`/`get`/`delete`/`wipe`), `createCredentialVault(deps)`, default `credentialVault`, `VaultKeyLostError` (`missing-key` | `decrypt-failed`).
- AES-GCM 256, non-extractable device key stored in IndexedDB (created on first `put`, never cached), 96-bit random IV per encryption, AAD = `ref`.
- Key id (`kid`, 16 random bytes) stored on the key and on every secret row: a secret encrypted with a lost/regenerated key reports `missing-key` (re-enter), a matching key that fails authentication reports `decrypt-failed` (tampering).
- Per-instance operation queue (put/get/delete/wipe run in call order); `putKeyIfAbsent` for cross-tab first-use races; `putKey` removed.
- Redaction: secrets are registered with the log redactor on `put` (before any await) and on `get`, and are never unregistered during the session (over-redaction is harmless; the redactor is not reference-counted).

## Review
- `/security-review`: no vulnerabilities.
- `/code-review`: 8 findings, all fixed with tests (decisions A–E: never unregister, operation queue, `kid`, re-read on missing key, remove `putKey`).

## Known limits
- Same-origin script can read secrets (ADR-006); mitigated by SEC-01 (CSP, sink lint).
- Cross-tab put vs wipe races are not serialized.
