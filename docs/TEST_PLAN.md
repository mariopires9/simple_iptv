# Plano de testes e qualidade

## 1. Pirâmide e ferramentas
| Nível | Ferramenta | Alvo | Onde corre |
|---|---|---|---|
| Unitário | Vitest 5 + jsdom | Parsers, normalizadores, schemas, redação, seleção de engine, lógica de retomar/zapping | Local + CI |
| Componente | Testing Library | Formulários, listas, leitor (media mock), estados | Local + CI |
| Integração | Vitest + MSW + `fake-indexeddb` | Cliente Xtream → worker → Dexie; import M3U → índice | Local + CI |
| Propriedades | fast-check | Parser M3U nunca lança exceção; redação nunca deixa passar segredos | CI |
| E2E | Playwright 1.64 (Chromium, WebKit, Firefox; viewports 390×844, 820×1180, 1440×900) | Fluxos críticos, PWA, offline | CI |
| Acessibilidade | `@axe-core/playwright` + manual (NVDA, VoiceOver) | Todas as rotas | CI + manual |
| Desempenho | Lighthouse CI, `size-limit`, traços Playwright, benchmarks Vitest (`bench`) | NFR-01..05 | CI (budgets) |
| Segurança | `npm audit`, licenças, ESLint security rules, testes XSS, `/security-review` | Dependências e código | CI + por story sensível |
| Manual | Checklist §5 | Dispositivos reais | Antes da release |

Cobertura mínima: 80 % linhas em `core/`, `providers/`, `player/select*`; sem meta global (evitar testes vazios).

## 2. Dados de teste
- `fixtures/xtream/`: `auth-ok.json`, `auth-fail.json`, `expired.json`, `live-streams-variantA/B/C.json`, `series-info-episodes-array.json`, `series-info-episodes-object.json`, `short-epg.json` (base64), números como string, campos `null`.
- `fixtures/m3u/`: `basic.m3u`, `attributes-edge-cases.m3u`, `crlf-bom.m3u`, `malicious.m3u` (`javascript:` URLs, `<script>` em nomes, atributos gigantes), gerador de 50k/200k entradas.
- `fixtures/xmltv/`: pequeno, `.gz`, entidades/CDATA, fusos.
- Streams: gerados por ffmpeg (testsrc + sine), licença própria; servidor local de testes com CORS ligável e modo "lento"/"erro 500"/"redirect 302".
- **Nunca** dados ou URLs de fornecedores reais em fixtures ou logs de CI.

## 3. Matriz de testes por área
| Área | Casos essenciais |
|---|---|
| Parser M3U | atributos com/sem aspas; vírgulas no nome; EXTGRP; BOM; CRLF; vazio; sem `#EXTM3U`; URL inválido; 50k performance; streaming parcial (chunk corta linha a meio) |
| Xtream | normalização de URL; auth ok/falha/expirado/banido; 401/403/404/500/timeout; JSON inválido; HTML em vez de JSON; `allowed_output_formats`; `https_port` |
| Erros de rede | mapeamento `TypeError`→`blocked` com hint mixed-content vs cors; abort; offline |
| Vault | cifra/decifra; IV único; chave não exportável; wipe; chave perdida → fluxo de recuperação |
| Persistência | replaceForSource atómico; remoção em cascata; favoritos persistem após resync; migração v1→v2 (quando existir) |
| Leitor | matriz `selectEngine` (container × capacidades × browser); destroy sem fugas (contagem de listeners/ObjectURLs); fallback .ts→.m3u8; erro de codec AC-3; retry com backoff; zapping rápido aborta pedidos |
| EPG | base64 UTF-8; timestamps/fusos; ausência de EPG; (v1.1) XMLTV gz, janela, matching |
| Pesquisa | acentos; prefixo; fuzzy; números de canal; 100k < 100 ms |
| PWA | instalabilidade (Lighthouse); precache; offline abre app; **Cache Storage sem URLs com credenciais**; prompt de atualização não interrompe reprodução |
| Responsividade | 3 viewports × rotas principais (screenshots de regressão visual opcionais) |
| A11y | axe por rota; fluxo só-teclado; foco visível; contraste dos tokens |
| Segurança | M3U malicioso não executa código; CSP presente; `no-referrer`; logs redigidos (snapshot); nenhuma requisição a domínios inesperados (Playwright `page.on('request')` com allowlist) |

## 4. Critérios mensuráveis (metas)
| Métrica | Meta | Medição |
|---|---|---|
| Arranque repetido (SW ativo) | Ecrã útil < 1,0 s (Android médio) / < 0,5 s desktop | Playwright + `performance.mark('app-ready')` com CPU throttling 4× |
| Primeiro carregamento | LCP < 2,5 s; TBT < 200 ms | Lighthouse mobile |
| JS inicial | ≤ 200 KB gz | size-limit |
| Mudar de ecrã (dados locais) | < 150 ms até conteúdo | `performance.measure` |
| Scroll 20k canais | 0 long tasks > 50 ms; ≥ 55 fps | traço Playwright |
| Filtro/pesquisa | < 100 ms (100k itens) | bench |
| Parse M3U 50k | < 5 s Android médio (≈ < 1,5 s desktop com 4× throttling como proxy) | bench |
| Zapping (stream local de teste) | primeiro frame < 1,5 s | E2E (`loadeddata`) |
| Zapping (fornecedor real) | registar p50/p75 — **sem meta garantida** | manual DEP-02 |

## 5. Checklist manual por dispositivo (DEP-02)
Para cada: Android Chrome · iPhone Safari (browser) · iPhone PWA instalada · Desktop Chrome · Desktop Firefox · (macOS Safari se disponível).
1. Instalar a app / adicionar ao ecrã inicial; ícone e nome corretos; abre em standalone.
2. Adicionar fonte real; diagnóstico coerente.
3. Reproduzir 5 canais (TS e HLS se disponível); medir tempo até primeiro frame; som presente?
4. Zapping 10× rápido; sem crash, sem áudio duplicado.
5. Ecrã inteiro, rotação, PiP, voltar do Android.
6. Filme: reproduzir, seek, sair, retomar.
7. Série: episódio seguinte.
8. Pesquisa; favoritos; recentes.
9. Modo avião: app abre, mensagens corretas.
10. Atualização da app com reprodução em curso.
11. Apagar todos os dados.
12. Leitor de ecrã (TalkBack/VoiceOver) no fluxo de zapping.
Registo em `docs/progress/compatibility-matrix.md` (data, dispositivo, SO, browser, resultado, notas). **Só o que foi testado é declarado compatível.**

## 6. Gates de qualidade
| Gate | Quando | Bloqueia merge/avanço se |
|---|---|---|
| CI | Cada PR/commit | lint, typecheck, testes, build, audit high, licenças |
| Revisão | Stories ≥ 3 pts ou sensíveis | achados críticos/altos não resolvidos |
| E2E + axe | A partir de QA-02 | falha em qualquer browser |
| Budgets | A partir de QA-03 | Lighthouse/size-limit abaixo das metas |
| Release | Antes de v1.0 | DEP-02 incompleto ou NFR sem medição |
