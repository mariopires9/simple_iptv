# Publicação e alojamento

> Nada foi publicado nem configurado. Este documento descreve o que será feito em DEP-01, **após aprovação explícita do utilizador**.

## 1. Decisão (ADR-007 aceite em 2026-10-28)
**GitHub Pages via GitHub Actions** — o utilizador já tem conta GitHub; não cria contas novas; HTTPS e domínio `https://<utilizador>.github.io/<repo>/` incluídos; limites (1 GB de site, 100 GB/mês soft) muito acima do necessário, porque o vídeo nunca passa pelo alojamento.

**Alternativa:** Cloudflare Pages (ou Workers static assets), se forem necessários headers HTTP próprios (CSP por header, `frame-ancestors`), repositório privado, ou um proxy em Workers. Vercel e Supabase avaliados e não recomendados (ver `RESEARCH.md §10.1`).

Comparação completa: `RESEARCH.md §10`.

## 2. Configuração prevista (DEP-01)
1. Repositório público `simple_iptv` (nome a confirmar).
2. Settings › Pages › Source: **GitHub Actions**.
3. Workflow `.github/workflows/deploy.yml`:
   - Trigger: `push` em `main` (após CI verde) e `workflow_dispatch`.
   - Jobs: `npm ci` → `npm run build` (com `VITE_BASE=/<repo>/`) → `actions/upload-pages-artifact` → `actions/deploy-pages`.
   - Permissões mínimas: `pages: write`, `id-token: write`, `contents: read`.
   - Actions fixadas por SHA.
4. `vite.config.ts`: `base: process.env.VITE_BASE ?? '/'`; manifesto com `start_url`/`scope` relativos ao base.
5. Router em modo hash (ADR-007) → sem necessidade de `404.html`.
6. CSP via `<meta>` (sem headers no Pages).
7. Smoke E2E contra o URL publicado (job pós-deploy, só leitura).

## 3. Ambientes
| Ambiente | Como | Uso |
|---|---|---|
| Local | `npm run dev` (http://localhost — contexto seguro) | Desenvolvimento |
| Preview local | `npm run build && npm run preview` | Testar SW/PWA |
| Produção | GitHub Pages | Utilização |
| Previews por PR | Não disponível no Pages; opcional com Cloudflare Pages no futuro | — |

## 4. Atualizações e rollback
- Cada deploy é uma build imutável; o SW deteta nova versão e pede ao utilizador para atualizar (PWA-03).
- Rollback: `git revert` + push (novo deploy) ou re-executar o workflow num commit anterior.
- Migrações IndexedDB devem ser compatíveis para a frente; nunca apagar dados do utilizador numa migração sem aviso.

## 5. Custos
| Item | Custo |
|---|---|
| Alojamento GitHub Pages | 0 € |
| GitHub Actions (repo público) | 0 € |
| Domínio | 0 € (`github.io`); domínio próprio opcional (~10 €/ano) |
| Serviço IPTV | Do utilizador, independente da app |

## 6. Riscos de plataforma
- Alterações aos planos gratuitos: a app é estática e portável (Cloudflare Pages, Netlify, GitLab Pages) com alterações mínimas (`base` e workflow).
- GitHub Pages proíbe usos como serviço comercial de alojamento de ficheiros/vídeo — não se aplica: só servimos a app.
