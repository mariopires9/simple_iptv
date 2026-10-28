# FND-06 — Logger com redação e modelo de erros

**Estado:** Done (2026-10-28) · agente `implementer` (worktree) · revisão: `/code-review` + `/security-review`

## Entregue
- `src/core/log`: `redact`, `registerSecret`/`unregisterSecret`/`clearSecrets`, `log.*`, buffer circular de 500, `exportDiagnostics`, `toLogJson`.
- `src/core/net/errors.ts`: `NetError` (`kind`, `status`, `hint`, `target` encurtado e redigido), `isNetError`, `shortenUrl`.

## Revisão
- `/security-review`: sem vulnerabilidades de alta confiança.
- `/code-review`: 10 achados; 9 corrigidos com testes de regressão (chaves camelCase e `Authorization`, forma form-urlencoded de segredos, caminhos Xtream sem prefixo `/<u>/<p>/<id>.ts`, `shortenUrl` só mantém segmentos conhecidos, valores JSON não-string, ciclos em `Error`, referências partilhadas, cadeia de `cause` redigida, cabeçalho do relatório não redigido). Não corrigido: custo O(n) do `splice` no buffer de 500 (desprezável).

## Limitações conhecidas
- Credenciais só são garantidamente removidas se registadas (`registerSecret`) — SRC-01/SRC-02 têm de as registar ao carregar.
- `Basic <b64>` sem `Authorization:` à frente e nomes em maiúsculas sem separador (`APIKEY`) não são mascarados por padrão.
- Testes de desempenho com limite de 250 ms podem ser sensíveis em CI lento.

## Evidência
Gates no `main` após merge: lint 0, typecheck 0, 138 testes, build ok.
