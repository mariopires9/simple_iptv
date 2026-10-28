# FND-05 — Camada de persistência (Dexie)

**Estado:** Done (2026-10-28) · agente `implementer` (worktree) · revisão: `/code-review`

## Entregue
- `src/core/db`: schema v1 (13 tabelas), `openDatabase`/`closeDatabase`/`wipeAll`, `DatabaseUnavailableError`, `DatabaseClosedError`, helpers de chaves, repositórios `sourcesRepo`, `catalogRepo`, `favoritesRepo`, `historyRepo`, `settingsRepo`, `vaultStore`.
- `src/i18n/pt-PT/db.ts`: mensagens de erro da base de dados (ADR-012).

## Revisão
`/code-review`: 10 achados, todos corrigidos com testes — concorrência abrir/fechar/apagar (contador de geração), `historyRepo.upsert` funde em vez de substituir, paginação real com índice `[categoryKey+order]` (substitui `[sourceId+categoryKey]`), `normalizeName` só remove marcas combinantes, deduplicação e contagens reais em `replaceForSource`, texto pt-PT movido para i18n, chaves de categoria rejeitadas como chaves de item, ramo `version` inalcançável removido.

## Verificação dos CA
| CA | Resultado | Evidência |
|---|---|---|
| 1. Base `simple-iptv` v1 com tabelas e índices | Cumprido | teste via API IndexedDB crua |
| 2. Repositórios tipados; sem `db.table()` nas features | Cumprido | `index.test.ts` analisa `src/` |
| 3. 100k itens numa transação, antigos removidos | Cumprido | 1,7–2,8 s em Node com fake-indexeddb (não é medição de browser) |
| 4. Remoção em cascata | Cumprido | teste com duas fontes |
| 5. IndexedDB indisponível → erro tipado | Cumprido | `unsupported`, `open-failed`, `timeout` |

## Riscos / pendências
- A ligação do erro à UI (ecrã de erro em vez de ecrã em branco) é feita em FND-04/UX-02.
- `epgPrograms` apaga por índice `sourceId` (mais lento); tabela só usada pós-MVP.
- Desempenho real em browser a medir em QA-03/DEP-02.
