# FND-07 — Infraestrutura de Web Worker

**Estado:** Done (2026-10-28) · agente `implementer` (worktree) · revisão: `/code-review`

## Entregue
- `src/core/worker`: `createDataWorkerApi`, `data.worker.ts`, cliente `getDataWorker`/`runTask`/`terminateDataWorker`, `WorkerTaskError` (`cancelled`|`failed`), registo de tarefas com tipos derivados, tarefa demo `selfTest`.
- Progresso com throttle de 50 ms por `MessageChannel` próprio (porta fechada em todos os caminhos); cancelamento imediato por `AbortSignal`.
- `vite.config.ts`: `worker.format: 'es'` (coordenador).

## Revisão
- `/code-review`: 9 achados; 7 corrigidos com testes (só mensagens de `WorkerTaskError` atravessam a fronteira; erros/morte do worker rejeitam chamadas pendentes e recriam o worker; abort rejeita de imediato; ordem aborted→ok; fuga de portas; flush com timeout; `AbortError` → `cancelled`).
- Não corrigidos, justificados: mensagens são diagnóstico (a UI mapeia `kind` para strings de `src/i18n`); RELEASE do proxy sem resposta é inofensivo.

## Verificação dos CA
| CA | Resultado | Evidência |
|---|---|---|
| 1. Comlink com progresso e cancelamento | Cumprido | `worker.test.ts` (27 testes, MessageChannel real) |
| 2. Erros com `kind`, sem dados sensíveis | Cumprido | testes de envelope (só `name/kind/message`) |
| 3. Chunk separado em produção | Cumprido | build com import temporário: `data.worker-*.js 6.28 kB` (formato ES) |

## Riscos
- Cancelamento cooperativo: tarefas que não chamam `throwIfCancelled()` atrasam as seguintes no worker único.
