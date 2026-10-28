# CLAUDE.md — Simple IPTV

Leitor IPTV PWA, client-side, sem backend. **Fase atual: execução autorizada (2026-10-28), story a story, segundo `docs/AGENT_WORKFLOW.md`.** Publicar (DEP-01) continua a exigir confirmação explícita.

## Ler antes de trabalhar
- Estado e próxima story: `docs/BACKLOG.md` (fonte única de verdade de estado)
- Story: `docs/USER_STORIES.md` · Arquitetura: `docs/ARCHITECTURE.md` · Decisões: `docs/DECISIONS.md`
- Processo multiagente e ficheiros serializados: `docs/AGENT_WORKFLOW.md`

## Regras
- Não implementar nada sem story ou justificação técnica; não alterar arquitetura sem ADR.
- Nunca guardar credenciais reais em ficheiros, fixtures, logs, prompts ou commits.
- Sem telemetria, analytics, publicidade ou recursos de CDNs de terceiros em runtime.
- Não publicar (GitHub Pages), criar contas ou mudar visibilidade de repositórios sem aprovação.
- Não contornar DRM, autenticação ou restrições de acesso; não incluir listas de terceiros.
- UI em pt-PT; strings em `src/i18n/pt-PT/<feature>.ts`.
- Não declarar compatibilidade/desempenho sem medição registada.

## Comandos
- `npm run dev` — servidor de desenvolvimento (http://localhost:5173)
- `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` — gates obrigatórios de cada story
- `npm run format` / `npm run format:check` — Prettier
- `VITE_BASE=/<repo>/ npm run build` — build para GitHub Pages

## Convenções de código
- TypeScript `strict` + `noUncheckedIndexedAccess`; alias `@/` → `src/`.
- Fronteiras entre módulos impostas pelo ESLint (`eslint.config.js`, testadas em `src/test/boundaries.test.ts`); dentro de uma feature usar imports relativos.
- `console` proibido fora de `src/core/log`; `dangerouslySetInnerHTML` proibido.
- Testes ao lado do código: `*.test.ts(x)`.
- Agentes de projeto: `.claude/agents/` (implementer, media-engineer, qa-engineer).
