# FND-01 — Project scaffold

**Status:** Done (2026-10-28)

## Scope
Vite 8 + React 19 + TypeScript 6 (strict), ESLint 9 (typescript-eslint, react-hooks, jsx-a11y, module boundaries), Prettier, Vitest 5 + jsdom + Testing Library, folder structure from `ARCHITECTURE.md §2`, project agents, CLAUDE.md with real commands.

## Technical decisions
- **TypeScript 6.0.3 instead of 7.0.2:** typescript-eslint 8.72 requires TypeScript < 6.1.
- **ESLint 9.39 instead of 10:** eslint-plugin-jsx-a11y 6.10 only declares support up to ESLint 9.
- Module boundaries with `no-restricted-imports` per folder (alias `@/`); within the same feature, relative imports are used.
- A single `tsconfig.json` (no project references) — simpler; `typecheck` = `tsc --noEmit`.
- Prettier does not format Markdown (doc tables are hand-written).

## AC verification
| AC | Result | Evidence |
|---|---|---|
| 1. `npm ci && npm run dev` opens the app | Met | Vite server served `index.html` with `<title>Simple IPTV</title>` and the `App.tsx` module |
| 2. lint, typecheck, test, build pass | Met | lint 0 problems; tsc no errors; 11 tests pass; build 68.7 KB gz |
| 3. `strict` + `noUncheckedIndexedAccess` | Met | `tsconfig.json` |
| 4. Folder structure with `index.ts` | Met | `src/**/index.ts` |
| 5. `core` → `features` fails lint | Met | `src/test/boundaries.test.ts` (6 forbidden cases, 4 allowed) |

## Open items
- Hooks proposed in `AGENT_WORKFLOW.md §7` not configured (optional).
- `npm audit`: 0 vulnerabilities at the time.
