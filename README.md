# Simple IPTV (nome provisório)

Leitor IPTV gratuito, open source, **sem anúncios e sem telemetria**, que corre no browser e se instala como PWA em Android, iOS e desktop. Ligas as **tuas** fontes (Xtream Codes ou M3U/M3U8) e vês TV em direto, filmes e séries.

> **Estado: planeamento concluído, implementação por iniciar.** Ainda não existe código nem dependências instaladas. Vê `docs/IMPLEMENTATION_PLAN.md` para os próximos passos.

## O que a app é (e não é)
- É um **leitor genérico**. Não inclui, não fornece e não sugere listas, canais ou conteúdos.
- Usa apenas fontes que tens autorização para aceder.
- Não tem backend: os teus dados ficam no teu dispositivo (credenciais cifradas).
- Limitação importante: servidores IPTV que só funcionam em **HTTP** ou sem **CORS** podem não reproduzir no browser — a app diagnostica e explica. Ver `docs/RESEARCH.md §6`.

## Stack planeada
React 19 + TypeScript + Vite · MUI · Dexie (IndexedDB) · hls.js + mpegts.js · vite-plugin-pwa · Vitest + Playwright · GitHub Pages.

## Documentação
| Documento | Conteúdo |
|---|---|
| [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) | Âmbito, MVP vs posterior, requisitos não funcionais |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Comparação de tecnologias, limitações dos browsers, alojamento |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Módulos, contratos, modelo de dados, cache |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Registo de decisões (ADR) |
| [docs/UX_UI.md](docs/UX_UI.md) | Sistema visual, wireframes, fluxos |
| [docs/USER_STORIES.md](docs/USER_STORIES.md) | Épicos e stories com critérios de aceitação |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Estado, dependências e ondas de execução |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Marcos, sequência, riscos, pressupostos |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Estratégia de testes e métricas |
| [docs/SECURITY.md](docs/SECURITY.md) | Segurança, privacidade e limites legais |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Publicação gratuita |
| [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md) | Orquestração com Claude Code |

## Instalação e execução (após FND-01)
```bash
npm ci
npm run dev        # desenvolvimento em http://localhost:5173
npm test           # testes unitários
npm run e2e        # testes E2E (Playwright)
npm run build      # build de produção em dist/
```
Requer Node 24 (ver `.nvmrc`, a criar).

## Licença
A definir pelo autor (sugestão: MIT). Dependências previstas: MIT / Apache-2.0 / ISC / OFL.
