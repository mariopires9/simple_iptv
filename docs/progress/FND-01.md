# FND-01 — Scaffold do projeto

**Estado:** Done (2026-10-28)

## Âmbito
Vite 8 + React 19 + TypeScript 6 (strict), ESLint 9 (typescript-eslint, react-hooks, jsx-a11y, fronteiras de módulos), Prettier, Vitest 5 + jsdom + Testing Library, estrutura de pastas de `ARCHITECTURE.md §2`, agentes de projeto, CLAUDE.md com comandos reais.

## Decisões técnicas
- **TypeScript 6.0.3 em vez de 7.0.2:** o typescript-eslint 8.72 exige TypeScript < 6.1.
- **ESLint 9.39 em vez de 10:** o eslint-plugin-jsx-a11y 6.10 só declara suporte até ao ESLint 9.
- Fronteiras de módulos com `no-restricted-imports` por pasta (alias `@/`); dentro da mesma feature usam-se imports relativos.
- Um único `tsconfig.json` (sem project references) — mais simples; `typecheck` = `tsc --noEmit`.
- Prettier não formata Markdown (tabelas dos docs escritas à mão).

## Verificação dos CA
| CA | Resultado | Evidência |
|---|---|---|
| 1. `npm ci && npm run dev` abre a app | Cumprido | Servidor Vite serviu `index.html` com `<title>Simple IPTV</title>` e o módulo `App.tsx` |
| 2. lint, typecheck, test, build passam | Cumprido | lint 0 problemas; tsc sem erros; 11 testes passam; build 68,7 KB gz |
| 3. `strict` + `noUncheckedIndexedAccess` | Cumprido | `tsconfig.json` |
| 4. Estrutura de pastas com `index.ts` | Cumprido | `src/**/index.ts` |
| 5. `core` → `features` falha no lint | Cumprido | `src/test/boundaries.test.ts` (6 casos proibidos, 4 permitidos) |

## Pendências
- Hooks propostos em `AGENT_WORKFLOW.md §7` não configurados (opcionais).
- `npm audit`: 0 vulnerabilidades à data.
