# FND-02 — Pipeline de CI

**Estado:** In Review — falta confirmar a primeira execução no GitHub (requer push).

## Âmbito
- `.github/workflows/ci.yml`: lint, format:check, typecheck, testes com cobertura, build, `npm audit --audit-level=high`, verificação de licenças; artefacto de cobertura. Actions fixadas por SHA (checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2), permissões `contents: read`.
- `.github/dependabot.yml`: npm e GitHub Actions, semanal.
- `scripts/check-licenses.mjs`: script próprio sem dependências (só pacotes de produção — os que entram no bundle), com testes.

## Decisões
- Verificação de licenças com script próprio em vez de `license-checker-rseidelsohn`: menos uma dependência, e o âmbito (dependências de produção) é o que a SECURITY.md exige.

## Verificação dos CA
| CA | Resultado | Evidência |
|---|---|---|
| 1. Workflow corre todos os passos | Local: todos os comandos passam (23 testes). **Pendente execução no GitHub** | — |
| 2. Licença fora da allowlist falha com o nome do pacote | Cumprido | `scripts/check-licenses.test.mjs` |
| 3. Dependabot + actions por SHA | Cumprido | `.github/dependabot.yml`, `ci.yml` |
