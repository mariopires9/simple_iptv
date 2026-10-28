# FND-02 — CI pipeline

**Status:** Done (2026-10-28)

## Scope
- `.github/workflows/ci.yml`: lint, format:check, typecheck, tests with coverage, build, `npm audit --audit-level=high`, license check; coverage artifact. Actions pinned by SHA (checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2), permissions `contents: read`.
- `.github/dependabot.yml`: npm and GitHub Actions, weekly.
- `scripts/check-licenses.mjs`: custom script with no dependencies (production packages only — those that end up in the bundle), with tests.

## Decisions
- License check with a custom script instead of `license-checker-rseidelsohn`: one fewer dependency, and the scope (production dependencies) is what SECURITY.md requires.

## AC verification
| AC | Result | Evidence |
|---|---|---|
| 1. Workflow runs all steps | Met | Run 40694334004 (commit e7f233e): green in 27 s, coverage artifact published |
| 2. License outside the allowlist fails with the package name | Met | `scripts/check-licenses.test.mjs` |
| 3. Dependabot + actions by SHA | Met | `.github/dependabot.yml`, `ci.yml` |
