# Plano de implementação

## 1. Pré-requisitos da fase de execução (requerem ação/aprovação do utilizador)
| # | Pré-requisito | Quem | Bloqueia |
|---|---|---|---|
| R1 | Aprovar ADRs `Proposta` (ou pedir alterações) | Utilizador | Tudo |
| R2 | Autorizar `git init` e instalação de dependências npm | Utilizador | FND-01 |
| R3 | Criar repositório GitHub (público) e `gh auth login` (`! gh auth login`) | Utilizador | FND-02, DEP-01 |
| R4 | Disponibilizar uma fonte IPTV legítima para o spike (credenciais introduzidas em runtime, nunca em ficheiros) | Utilizador | S-00 |
| R5 | Confirmar nome do produto (provisório: "Simple IPTV") | Utilizador | PWA-01 (não bloqueante: pode mudar depois) |
| R6 | Aprovar primeira publicação no GitHub Pages | Utilizador | DEP-01 |

## 2. Marcos

| Marco | Objetivo | Stories | Critério de saída |
|---|---|---|---|
| **M0 — Fundações** | Base técnica, CI, design system, deploy de esqueleto | S-00, FND-01..07, PWA-01, SEC-01, QA-01, QA-03, DEP-01, UX-02 | CI verde; esqueleto publicado (se R6); ADR-010 decidido |
| **M1 — Primeiro canal** (fatia vertical) | Adicionar fonte Xtream/M3U e ver TV em direto com zapping | SRC-01..07, SRC-09, PLY-01..04, LIV-01..04, UX-01, QA-02 | Um utilizador real vê os seus canais no Chrome Android e desktop (ou o bloqueio está documentado e PRX-01 entra no plano) |
| **M2 — Catálogo completo** | Filmes, séries, pesquisa, favoritos, EPG agora/seguinte | VOD-*, SER-*, SCH-*, FAV-*, EPG-01, SRC-08 | Fluxos E2E completos verdes |
| **M3 — Release v1.0** | PWA completa, a11y, desempenho, validação em dispositivos | PWA-02..05, SRC-10, UX-03, UX-04, DEP-02 | Todos os NFR medidos; matriz de compatibilidade publicada; aprovação do utilizador |
| M4 — v1.1 | Pós-MVP priorizado após feedback | EPG-02/03, PLY-05, SEC-02, EXP-01, MSS-01, PRX-01 (se não entrou antes) | — |

## 3. Sequência por ondas (paralelismo)

| Onda | Stories (paralelizáveis entre si) | Notas |
|---|---|---|
| 0 | S-00 ∥ FND-01 | S-00 é manual com o utilizador; FND-01 é sequencial (cria ficheiros partilhados) |
| 1 | FND-02 ∥ FND-03 ∥ FND-05 ∥ FND-06 ∥ FND-07 ∥ PWA-01 ∥ SEC-01 ∥ QA-01 | Máx. 3 em paralelo recomendado (revisão é o gargalo) |
| 2 | FND-04, UX-02, SRC-01, SRC-02, SRC-04, PLY-01, FAV-01, FAV-02, PWA-02, PWA-05, QA-03, DEP-01 | Priorizar SRC-01/02, PLY-01 (caminho M1) |
| 3 | UX-01, SRC-03, SRC-05, SRC-06, SRC-07, VOD-04, PLY-02, PLY-04, PWA-03, PWA-04, QA-02 | |
| 4 | SRC-08, SRC-09, SRC-10, LIV-01, VOD-01, PLY-03, SCH-01 | **Checkpoint M1 após LIV-02** |
| 5 | LIV-02, LIV-04, VOD-02, SER-01, EPG-01, SCH-02, UX-04 | |
| 6 | LIV-03, VOD-03, SER-02 | |
| 7 | SER-03, FAV-03, UX-03 | Release candidate |
| 8 | DEP-02 | Manual com o utilizador |

Regra: dentro de uma onda, o coordenador escolhe primeiro as stories do marco ativo e do caminho crítico (ver `BACKLOG.md`).

## 4. Pontos de controlo com o utilizador
1. **Após S-00:** decisão ADR-010 (proxy/nativo/aceitar limitação).
2. **Após FND-03:** validação visual (screenshots do AppShell em escuro/claro, 3 tamanhos) e bundle do MUI (ADR-003).
3. **Após M1:** demonstração com a fonte real; go/no-go para M2.
4. **Antes de DEP-01 e de cada publicação pública relevante.**
5. **Após DEP-02:** aprovação de release v1.0.

## 5. Riscos

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| RK1 | Fornecedor do utilizador HTTP-only/sem CORS → nada reproduz no browser | **Alta** | **Crítico** | S-00 primeiro; diagnóstico claro; PRX-01 / NAT-01 |
| RK2 | Áudio AC-3/MP2 sem som em Chrome | Média | Alto | Deteção + mensagem; preferir HLS (frequentemente AAC); documentar |
| RK3 | iPhone: comportamento MMS/fullscreen/background diferente | Média | Médio | Engine nativa HLS no Safari; testes reais DEP-02 |
| RK4 | Catálogos enormes (100k+ VOD) esgotam memória em telemóveis fracos | Média | Médio | Worker, bulk em lotes, sincronização por categoria como plano B |
| RK5 | Variações entre painéis Xtream | Alta | Médio | Schemas tolerantes, fixtures de várias variantes |
| RK6 | Safari apaga dados de sites não instalados | Média | Médio | `persist()`, incentivo à instalação |
| RK7 | Peso do MUI acima do orçamento | Baixa | Baixo | Medir em FND-03; alternativa Radix |
| RK8 | Alterações de planos gratuitos (Pages) | Baixa | Baixo | App estática portável para Cloudflare/Netlify em minutos |
| RK9 | Uso indevido da app com listas não autorizadas | Média | Médio (reputacional) | Sem listas incluídas, aviso legal, sem diretórios/pesquisa de listas |
| RK10 | Agentes paralelos com alterações conflituosas | Média | Médio | Política de ficheiros serializados, worktrees, revisão (`AGENT_WORKFLOW.md`) |

## 6. Pressupostos e dúvidas em aberto
| # | Dúvida | Pressuposto atual | Impacto se errado |
|---|---|---|---|
| Q1 | O fornecedor do utilizador suporta HTTPS/CORS? | Desconhecido → S-00 | Ver RK1 |
| Q2 | Dispositivos-alvo principais? | Android + desktop; iPhone secundário | Ordem de testes em DEP-02 |
| Q3 | Repo público aceitável? | Sim (código sem segredos) | Se não: Cloudflare Pages (aceita repo privado) |
| Q4 | Idiomas além de pt-PT? | Não no MVP | Strings já externalizadas |
| Q5 | Usar a app numa TV/box Android? | Não no MVP (UX-05 depois) | Subir UX-05 |
| Q6 | Nome/marca | "Simple IPTV" provisório | Só textos e ícones |

## 7. Como iniciar a execução (fase 2)
Pedido sugerido ao Claude Code:
> "Aprovo os ADR-001 a ADR-009 e 011 a 013. Autorizo git init e instalação de dependências. Executa a onda 0 (FND-01) seguindo `docs/AGENT_WORKFLOW.md` e prepara o spike S-00."

Depois, por onda ou por marco:
> "Executa o marco M1 seguindo o workflow; para nos pontos de controlo."
