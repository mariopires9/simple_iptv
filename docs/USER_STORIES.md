# User stories

Estado de cada story: ver **`BACKLOG.md`** (fonte única de verdade para estados). Este ficheiro contém o conteúdo; não editar estados aqui.

## Convenções
- **Prioridade:** `Must` (MVP) · `Should` (v1.1) · `Could` (experimental/posterior).
- **Esforço:** pontos relativos 1 · 2 · 3 · 5 · 8 (8 = máximo; maior → dividir).
- **Valor:** Alto / Médio / Baixo para o utilizador final.
- **CA:** critérios de aceitação em Given/When/Then.

### Definição de Pronto (DoR) — para passar a `Ready`
Dependências em `Done`; CA verificáveis; ficheiros/áreas previstas listadas; dúvidas resolvidas ou pressupostos registados.

### Definição de Concluído (DoD) — aplica-se a todas as stories
1. Todos os CA cumpridos e demonstrados por testes automáticos (ou, se impossível, verificação manual registada em `docs/progress/`).
2. `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` sem erros.
3. Sem `console.log` com dados sensíveis; logger com redação usado.
4. Strings de UI em `src/i18n/pt-PT/<feature>.ts`.
5. Revisão independente (`/code-review`) para stories ≥ 3 pontos ou que toquem em `core/`, `player/`, segurança ou ficheiros partilhados; achados corrigidos ou justificados.
6. Acessibilidade: componentes novos com nome acessível e foco visível; E2E com axe quando a story tem UI.
7. `BACKLOG.md` atualizado; ADR criado se houve decisão arquitetural.
8. Bundle inicial não ultrapassa o orçamento (após QA-03 existir).

---

## Spike

### S-00 — Validar compatibilidade do fornecedor IPTV real
- **Épico:** E0 · **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto (decide ADR-010)
- **História:** Como dono do produto, quero saber se o meu fornecedor funciona a partir de uma página HTTPS no browser, para decidir se o MVP precisa de proxy ou shell nativo.
- **CA:**
  1. Given credenciais reais fornecidas pelo utilizador em runtime (nunca em ficheiro), When se executa a página de spike servida por `https://localhost`/Pages de teste, Then o relatório indica: HTTPS disponível (sim/não, porta), CORS em `player_api.php` (sim/não), formatos permitidos (`allowed_output_formats`), redirecionamentos de stream (host destino e esquema).
  2. Given um canal de teste, When se tenta reproduzir em `.ts` (mpegts.js) e `.m3u8` (hls.js e nativo), Then regista-se sucesso/falha por browser (Chrome desktop, Chrome Android, Safari iOS se disponível) e codecs detetados.
  3. Given os resultados, Then ADR-010 passa a `Aceite` com a opção escolhida, e o backlog é ajustado (PRX-01/NAT-01 sobem para Must se necessário).
- **Dependências:** nenhuma (pode correr em paralelo com FND-01).
- **Tarefas:** página HTML isolada em `spikes/compat/` (descartável, fora de `src/`); testes manuais; relatório `docs/progress/S-00-report.md` **sem credenciais nem host completo** (host mascarado).
- **Testes:** manuais, registados.
- **Riscos:** o utilizador pode não ter dispositivo iOS; resultado depende da hora/servidor.
- **DoD específico:** relatório + ADR-010 atualizado; código do spike não entra no build da app.

---

## E0 — Fundações

### FND-01 — Scaffold do projeto
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Médio (habilitador)
- **História:** Como programador, quero um projeto Vite + React + TS com lint, formatação e testes configurados, para que todas as stories partam de uma base consistente.
- **CA:**
  1. Given um clone limpo, When `npm ci && npm run dev`, Then a app abre em `localhost` com um ecrã placeholder.
  2. Given o projeto, When `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, Then todos passam.
  3. Given `tsconfig`, Then `strict: true`, `noUncheckedIndexedAccess: true`.
  4. Given a estrutura de pastas de `ARCHITECTURE.md §2`, Then existe com `README` mínimo por módulo ou `index.ts`.
  5. Given regras de fronteira, When um ficheiro de `core/` importa de `features/`, Then o lint falha.
- **Dependências:** — (requer `git init` autorizado).
- **Tarefas:** `git init`, `.gitignore`, `package.json` scripts, ESLint flat config (typescript-eslint, react-hooks, jsx-a11y, import boundaries), Prettier, Vitest + jsdom + Testing Library, `.nvmrc` (Node 24), `.editorconfig`, `CLAUDE.md` atualizado com comandos reais, `.claude/agents/*` (ver `AGENT_WORKFLOW.md`).
- **Testes:** teste trivial de render; teste de lint de fronteiras (ficheiro fixture).
- **Riscos:** versões major recentes (Vite 8, React 19.3, Vitest 5) com plugins desalinhados → fixar versões compatíveis.

### FND-02 — Pipeline de CI
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Médio
- **História:** Como mantenedor, quero que cada push e PR execute lint, typecheck, testes, build e auditoria, para detetar regressões cedo.
- **CA:**
  1. Given um PR, When o workflow corre, Then executa `lint`, `typecheck`, `test --coverage`, `build`, `npm audit --audit-level=high` e verificação de licenças (allowlist: MIT, ISC, BSD-2/3, Apache-2.0, OFL-1.1, 0BSD, CC0).
  2. Given uma dependência com licença fora da allowlist, Then o job falha com o nome do pacote.
  3. Given Dependabot/Renovate, Then está configurado semanalmente para npm e GitHub Actions (com actions fixadas por SHA).
- **Dependências:** FND-01.
- **Tarefas:** `.github/workflows/ci.yml`, `license-checker-rseidelsohn` ou script próprio, `dependabot.yml`.
- **Testes:** execução do workflow num PR de teste.
- **Riscos:** requer repositório GitHub (decisão D-2 do utilizador).

### FND-03 — Design tokens, tema e AppShell
- **Prioridade:** Must · **Esforço:** 5 · **Valor:** Alto
- **História:** Como utilizador, quero uma interface coerente em tema escuro e claro, adaptada ao meu ecrã, para navegar confortavelmente.
- **CA:**
  1. Given os tokens de `UX_UI.md §2`, When o tema MUI é criado, Then todos os componentes usam tokens (sem cores literais fora de `ui/theme`).
  2. Given pares texto/fundo definidos, When o teste de contraste corre, Then todos cumprem ≥ 4,5:1 (texto) e ≥ 3:1 (UI); caso contrário os tokens são ajustados e documentados.
  3. Given largura < 600 px, Then aparece barra inferior; 600–1199 px rail; ≥ 1200 px rail expandido.
  4. Given a preferência "Sistema/Escuro/Claro", When muda, Then o tema muda sem recarregar e persiste.
  5. Given `prefers-reduced-motion`, Then transições são desativadas.
- **Dependências:** FND-01.
- **Tarefas:** `ui/theme/tokens.ts`, `createTheme`, `CssBaseline`, fonte Inter auto-alojada, `AppShell` com `BottomNav`/`NavRail`, `TopBar`, ripple off.
- **Testes:** unit de contraste (cálculo WCAG sobre tokens); componente AppShell em 3 viewports (Playwright, depois de QA-02) ou testes de render com `matchMedia` mock.
- **Riscos:** peso do MUI — medir bundle no fim da story (alimenta ADR-003).

### FND-04 — Routing e esqueleto de ecrãs
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Médio
- **História:** Como utilizador, quero navegar entre Início, Direto, Filmes, Séries, Favoritos, Pesquisa e Definições, e que os links profundos funcionem, para chegar rapidamente onde quero.
- **CA:**
  1. Given o hash router, When abro `/#/movies/category/123` diretamente, Then a rota correta é apresentada (sem 404 em GitHub Pages).
  2. Given cada rota, Then é carregada com `lazy()` (chunk próprio).
  3. Given rota desconhecida, Then mostra ecrã "Página não encontrada" com link para Início.
  4. Given o botão "voltar" do Android/browser, Then volta ao ecrã anterior (não fecha a app desde o leitor).
- **Dependências:** FND-03.
- **Tarefas:** `app/router.tsx`, `ErrorBoundary` por rota, placeholders.
- **Testes:** unit de rotas (memory router); E2E deep link.

### FND-05 — Camada de persistência (Dexie)
- **Prioridade:** Must · **Esforço:** 5 · **Valor:** Alto (habilitador)
- **História:** Como utilizador, quero que as minhas fontes, favoritos e progresso fiquem guardados no dispositivo, para não ter de os reconfigurar.
- **CA:**
  1. Given o schema de `ARCHITECTURE.md §5`, When a app arranca, Then a base `simple-iptv` v1 é criada.
  2. Given repositórios tipados (`sourcesRepo`, `catalogRepo`, `favoritesRepo`, `historyRepo`, `settingsRepo`), Then nenhuma feature usa `db.table()` diretamente.
  3. Given 100 000 itens, When `catalogRepo.replaceForSource(sourceId, type, items)`, Then conclui numa única transação e itens antigos dessa fonte+tipo são removidos.
  4. Given remoção de uma fonte, Then todos os registos com esse `sourceId` são apagados (catálogo, favoritos, histórico, índice, segredo).
  5. Given IndexedDB indisponível (ex.: modo privado restrito), Then a app mostra erro claro e não fica em branco.
- **Dependências:** FND-01.
- **Tarefas:** `core/db/schema.ts`, `repos/*`, `wipeAll()`, helpers de chave composta.
- **Testes:** unit com `fake-indexeddb`; teste de desempenho de bulkPut (marcado `@slow`).
- **Riscos:** limites de quota em iOS; migrações futuras.

### FND-06 — Logger com redação e modelo de erros
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Médio (segurança)
- **História:** Como utilizador, quero que as minhas credenciais nunca apareçam em logs ou mensagens de erro, para não as expor ao partilhar um problema.
- **CA:**
  1. Given uma string com `password=abc`, `username=joao`, `/live/joao/abc/1.ts` ou um segredo registado, When é registada, Then sai como `password=***`, `/live/***/***/1.ts`.
  2. Given um `NetError`, Then contém `kind` e nunca o URL completo não redigido.
  3. Given o buffer de logs, When o utilizador exporta "Relatório de diagnóstico", Then o ficheiro passa pelos mesmos filtros.
- **Dependências:** FND-01.
- **Tarefas:** `core/log`, `core/net/errors.ts`, função `redact()`.
- **Testes:** unit com casos de URLs Xtream, M3U `get.php`, query strings, URL-encoded, base64.

### FND-07 — Infraestrutura de Web Worker
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Médio (desempenho)
- **História:** Como utilizador, quero que a app continue fluida enquanto carrega listas grandes, para não ficar com o ecrã congelado.
- **CA:**
  1. Given o worker de dados, When chamado via Comlink, Then suporta progresso (callback) e cancelamento (`AbortSignal` → flag).
  2. Given um erro no worker, Then é propagado como `Error` serializado com `kind`, sem dados sensíveis.
  3. Given build de produção, Then o worker é um chunk separado.
- **Dependências:** FND-01.
- **Testes:** unit da API (com worker simulado); E2E mede ausência de long tasks durante tarefa sintética.

---

## E1 — Fontes IPTV

### SRC-01 — Cofre de credenciais
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero que a palavra-passe do meu serviço IPTV fique cifrada no dispositivo, para reduzir o risco de exposição se alguém copiar os dados da app.
- **CA:**
  1. Given o primeiro uso, When o vault é inicializado, Then gera uma chave AES-GCM 256 **não exportável** e guarda-a em IndexedDB.
  2. Given `put(ref, secret)`, Then a tabela `secrets` contém só `iv` + `ciphertext` (verificado por teste que lê a tabela crua).
  3. Given `get(ref)`, Then devolve o segredo original; IV único por cifra.
  4. Given `wipe()`, Then chave e segredos são apagados.
  5. Given a página "Privacidade", Then explica em linguagem simples o que esta proteção cobre e não cobre (ADR-006).
- **Dependências:** FND-05, FND-06.
- **Testes:** unit (WebCrypto em Node 24 / jsdom), teste de não-exportabilidade.
- **Riscos:** perda da chave (ex.: limpeza parcial pelo browser) → segredos ilegíveis → fluxo "Reintroduzir palavra-passe".

### SRC-02 — Cliente Xtream: autenticação e conta
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero saber logo se os dados do meu fornecedor estão corretos e o estado da minha conta, para não perder tempo com configurações erradas.
- **CA:**
  1. Given um servidor introduzido como `exemplo.com:8080`, `http://exemplo.com:8080/`, ou com `/player_api.php`, Then é normalizado para `scheme://host:port`.
  2. Given credenciais válidas, When `testConnection()`, Then devolve `account` (estado, expiração, ligações, formatos).
  3. Given `user_info.auth = 0` ou 401/403, Then `NetError(kind='auth')` → mensagem "Utilizador ou palavra-passe incorretos".
  4. Given `status` ≠ `Active` (Expired, Banned, Disabled), Then mensagem específica.
  5. Given `TypeError` no fetch com página HTTPS e servidor `http:`, Then `kind='blocked', hint='mixed-content'`; com servidor `https:`, `hint='cors'`.
  6. Given servidor `http:` e `server_info.https_port` presente, Then tenta automaticamente `https://host:https_port` e reporta o resultado.
  7. Given timeout (15 s), Then `kind='timeout'`.
- **Dependências:** FND-06.
- **Tarefas:** `providers/xtream/client.ts`, `schemas.ts` (Valibot), `normalizeServerUrl`.
- **Testes:** unit com MSW e fixtures (`fixtures/xtream/*.json`) incluindo variantes de painéis, números como string, campos nulos.

### SRC-03 — Adicionar fonte Xtream (UI)
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero introduzir servidor, utilizador e palavra-passe num formulário simples e testar a ligação, para começar a ver TV.
- **CA:**
  1. Given campos vazios ou URL inválida, When submeto, Then vejo erros por campo, com foco no primeiro erro.
  2. Given dados válidos, When "Testar e guardar", Then vejo as etapas do teste e, em sucesso, a fonte é guardada (palavra-passe no vault) e a sincronização inicia (SRC-07).
  3. Given falha, Then a mensagem vem do mapa de erros com ação sugerida e os dados do formulário mantêm-se.
  4. Given o campo palavra-passe, Then tem `autocomplete="current-password"`, botão mostrar/ocultar com `aria-pressed`.
  5. Given aviso de HTTP-only, Then o utilizador pode guardar na mesma, depois de ver o aviso.
- **Dependências:** SRC-01, SRC-02, FND-04, UX-02.
- **Testes:** componente (Testing Library) + E2E com MSW.

### SRC-04 — Parser M3U/M3U8 em streaming
- **Prioridade:** Must · **Esforço:** 5 · **Valor:** Alto
- **História:** Como utilizador com uma lista M3U, quero que a lista seja lida corretamente, incluindo logos e grupos, para ver os canais organizados.
- **CA:**
  1. Given `#EXTINF` com `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, `tvg-chno`, `catchup*`, Then todos os atributos são extraídos (aspas simples/duplas, espaços, vírgulas no nome).
  2. Given cabeçalho `#EXTM3U url-tvg="..."` ou `x-tvg-url`, Then o URL EPG é capturado.
  3. Given linhas `#EXTVLCOPT`/`#KODIPROP`/`#EXTGRP`, Then são associadas à entrada seguinte (EXTGRP como grupo se não houver group-title) ou ignoradas sem erro.
  4. Given BOM UTF-8, CRLF, linhas vazias, entradas sem `#EXTINF`, Then o parser é tolerante.
  5. Given entradas com URL `javascript:`, `data:`, `file:` ou inválido, Then são descartadas e contadas como "ignoradas".
  6. Given um stream de texto de 50 000 entradas, Then processa em chunks, emite progresso e não acumula o ficheiro inteiro duas vezes em memória.
  7. Given entradas, Then cada uma é classificada `live|movie|series` (heurística VOD-04 — inicialmente tudo `live` exceto URLs com `/movie/` ou `/series/`).
- **Dependências:** FND-07.
- **Testes:** unit com fixtures sintéticas (válidas, mal formadas, enormes geradas), property-based (fast-check) para robustez; benchmark.

### SRC-05 — Importar M3U por URL
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero colar o URL da minha lista M3U, para importar os canais sem descarregar ficheiros.
- **CA:**
  1. Given um URL `http(s)://`, When importo, Then é descarregado em streaming no worker com progresso (bytes e entradas).
  2. Given um URL do tipo `get.php?username=…&password=…`, Then a app sugere "Este URL parece ser de um servidor Xtream — usar modo Xtream (recomendado)" e preenche o formulário Xtream.
  3. Given CORS/mixed content bloqueado, Then mensagem acionável sugerindo descarregar o ficheiro e usar importação local (SRC-06).
  4. Given resposta que não começa por `#EXTM3U` (ex.: HTML de erro), Then erro "O URL não devolveu uma lista M3U".
  5. Given o URL, Then é guardado no vault (contém frequentemente credenciais).
- **Dependências:** SRC-04, SRC-01, FND-05.
- **Testes:** unit/integração com MSW; E2E.

### SRC-06 — Importar ficheiro M3U local
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Médio
- **História:** Como utilizador, quero escolher um ficheiro `.m3u`/`.m3u8` do meu dispositivo, para usar listas que não estão online ou cujo servidor bloqueia o browser.
- **CA:**
  1. Given o seletor de ficheiros (`accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl"`), When escolho um ficheiro, Then é lido via `file.stream()` no worker.
  2. Given um ficheiro > 50 MB, Then aviso de tempo e confirmação.
  3. Given fonte do tipo ficheiro, Then "Atualizar" pede novo ficheiro (não há URL).
- **Dependências:** SRC-04, FND-05.
- **Testes:** componente + E2E com `setInputFiles`.

### SRC-07 — Sincronizar catálogo Xtream
- **Prioridade:** Must · **Esforço:** 5 · **Valor:** Alto
- **História:** Como utilizador, quero que os canais, filmes e séries do meu fornecedor sejam carregados e guardados, para navegar rapidamente mesmo com milhares de itens.
- **CA:**
  1. Given uma fonte Xtream, When sincroniza, Then obtém categorias e itens de live, movie e series no worker e grava via `replaceForSource` (fluxo `ARCHITECTURE.md §6.1`).
  2. Given respostas com itens inválidos, Then esses itens são ignorados e contados; o resto é gravado.
  3. Given re-sincronização, Then favoritos e histórico mantêm-se (chaves estáveis por `stream_id`/`series_id`).
  4. Given cancelamento, Then dados anteriores permanecem intactos (transação por tipo).
  5. Given `lastSyncAt` > 24 h ao abrir a app com rede, Then sincronização em segundo plano com indicador discreto.
  6. Given falha num tipo (ex.: séries 500), Then os outros tipos ficam disponíveis e o erro é mostrado na fonte.
- **Dependências:** SRC-02, FND-05, FND-07.
- **Testes:** integração com MSW + fake-indexeddb; fixture grande gerada (50k VOD).
- **Riscos:** JSON de dezenas de MB → memória em dispositivos fracos (medir; plano B: carregar por categoria).

### SRC-08 — Página "As minhas listas"
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero uma página com todas as minhas listas IPTV guardadas, onde as posso ver, editar, atualizar, remover e escolher qual usar, para gerir várias subscrições ou listas.
- **CA:**
  0. Given a página "As minhas listas" (`UX_UI.md §4.1b`), Then é acessível pelo seletor de lista na barra superior ("Gerir listas…"), por Definições e pelo rail em desktop; não há limite artificial ao número de listas.
  1. Given a página, Then cada lista mostra nome, tipo (Xtream / M3U URL / M3U ficheiro), contagens, última sincronização, estado, indicação "ATIVA" e (Xtream) expiração da conta.
  2. Given "Editar", When altero credenciais e guardo, Then testa a ligação antes de aplicar.
  3. Given "Remover", When confirmo num diálogo, Then a fonte e todos os dados associados são apagados (FND-05 CA4).
  4. Given várias fontes, When escolho outra no seletor da barra superior, Then todos os ecrãs passam a usar a fonte ativa em < 300 ms (sem rede).
  5. Given "Atualizar", Then sincroniza (SRC-07/SRC-05) com progresso.
- **Dependências:** SRC-03, SRC-05, SRC-07.
- **Testes:** componente + E2E.

### SRC-09 — Diagnóstico de compatibilidade
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero perceber porque é que uma fonte não funciona no browser e o que posso fazer, para não ficar sem saber se o problema é meu, do fornecedor ou do browser.
- **CA:**
  1. Given uma fonte, When abro "Diagnóstico", Then vejo checklist: HTTPS, acesso à API (CORS), formato live (TS/HLS), suporte do browser (MSE/MMS, HLS nativo), codecs testados (`isTypeSupported` H.264/HEVC/AAC/AC-3).
  2. Given cada falha, Then há explicação e ações possíveis (usar HTTPS se o fornecedor tiver, ficheiro local, Safari, proxy pessoal quando existir).
  3. Given "Copiar relatório", Then o texto não contém credenciais nem o host completo (mascarado).
- **Dependências:** SRC-02, PLY-01.
- **Testes:** unit dos verificadores; snapshot do relatório redigido.

### SRC-10 — Apagar todos os dados locais
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Alto (privacidade)
- **História:** Como utilizador, quero apagar todos os dados da app com uma ação, para vender/emprestar o dispositivo ou recomeçar.
- **CA:**
  1. Given Definições › Privacidade › "Apagar todos os dados", When confirmo escrevendo `APAGAR`, Then IndexedDB, Cache Storage e preferências são removidos e a app volta ao onboarding.
  2. Given a operação, Then o service worker mantém-se (app continua instalada) mas sem dados.
  3. Given falha parcial, Then a app informa e oferece repetir.
- **Dependências:** FND-05, SRC-01, PWA-02.
- **Testes:** E2E verifica `indexedDB.databases()` vazio e `caches.keys()` sem caches de dados.

---

## E3 — Leitor

### PLY-01 — Motor de reprodução e seleção de engine
- **Prioridade:** Must · **Esforço:** 5 · **Valor:** Alto
- **História:** Como utilizador, quero que a app escolha automaticamente a melhor forma de reproduzir cada stream, para não ter de perceber formatos.
- **CA:**
  1. Given `StreamDescriptor` e `Capabilities`, When `selectEngine`, Then segue a tabela de `RESEARCH.md §5.2` (testável com matriz de casos).
  2. Given hls.js/mpegts.js, Then só são descarregados no primeiro uso (chunks separados; verificado no build).
  3. Given troca de stream, Then a engine anterior é destruída (sem fugas: listeners, `MediaSource`, `ObjectURL` revogados).
  4. Given falha com `fallbacks`, Then tenta o próximo descriptor uma vez antes de reportar erro.
  5. Given `UrlRewriter`, Then todos os URLs passam por ele (identidade no MVP).
- **Dependências:** FND-01, FND-06.
- **Tarefas:** `player/engines/*`, `player/select.ts`, `core/platform/capabilities.ts`.
- **Testes:** unit da matriz; integração em Playwright (Chromium + WebKit) com streams de teste locais (QA-01).
- **Riscos:** diferenças MMS vs MSE no iOS (validar em S-00/DEP-02).

### PLY-02 — UI do leitor e controlos
- **Prioridade:** Must · **Esforço:** 5 · **Valor:** Alto
- **História:** Como utilizador, quero controlos claros (play/pausa, volume, progresso, direto), para controlar a reprodução facilmente em qualquer dispositivo.
- **CA:**
  1. Given um stream live, Then mostra indicador "Direto" e não mostra barra de seek (exceto se `seekable` > 30 s — DVR).
  2. Given VOD, Then barra de progresso com tempo atual/total, seek por clique/toque/teclas ±10 s.
  3. Given inatividade 3 s a reproduzir, Then controlos escondem-se; reaparecem com toque/rato/tecla.
  4. Given atalhos de `UX_UI.md §4.5`, Then funcionam quando o leitor tem foco e não interferem com campos de texto.
  5. Given estado de buffering, Then spinner após 500 ms (sem flash).
  6. Given leitor de ecrã, Then todos os botões têm `aria-label` e a mudança de estado é anunciada.
- **Dependências:** PLY-01, FND-03.
- **Testes:** componente com `HTMLMediaElement` mock; E2E com stream de teste; axe.

### PLY-03 — Ecrã inteiro, orientação e Picture-in-Picture
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero ver em ecrã inteiro e em PiP, para aproveitar o ecrã ou continuar a ver enquanto faço outra coisa.
- **CA:**
  1. Given Fullscreen API disponível, Then o contentor do leitor (com overlay próprio) entra em ecrã inteiro.
  2. Given iPhone (sem Fullscreen API em elementos), Then usa `video.webkitEnterFullscreen()` e a UI informa que os controlos são os do sistema.
  3. Given mobile em paisagem durante reprodução e opção ativa, Then entra em ecrã inteiro; `screen.orientation.lock` usado apenas onde suportado, sem erros onde não é.
  4. Given PiP suportado (`document.pictureInPictureEnabled` ou `webkitSetPresentationMode`), Then botão PiP visível; caso contrário, oculto.
- **Dependências:** PLY-02.
- **Testes:** unit com feature detection mockada; manual em dispositivos (DEP-02).

### PLY-04 — Erros de reprodução e recuperação
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero perceber porque é que um canal não abre e tentar de novo facilmente, para não ficar perante um ecrã preto.
- **CA:**
  1. Given erro de rede transitório em live, Then até 3 tentativas com backoff (1 s, 2 s, 4 s) antes de mostrar erro.
  2. Given `MEDIA_ERR_SRC_NOT_SUPPORTED`/`bufferAddCodecError`/`isTypeSupported=false`, Then mensagem "formato/codec não suportado" com o codec quando conhecido.
  3. Given vídeo a reproduzir mas faixa de áudio não suportada, Then aviso "sem som: áudio X não suportado neste browser".
  4. Given 401/403/`max_connections` atingido (quando detetável), Then mensagem de conta/ligações.
  5. Given `blocked`, Then mensagem de HTTPS/CORS com link para diagnóstico (SRC-09).
  6. Given ecrã de erro, Then "Tentar novamente" e (live) "Canal seguinte".
- **Dependências:** PLY-01, FND-06.
- **Testes:** unit do mapeamento erro→mensagem; integração com streams de teste corrompidos/codec inválido.

### PLY-05 — Faixas de áudio e legendas
- **Prioridade:** Should · **Esforço:** 3 · **Valor:** Médio
- **História:** Como utilizador, quero escolher o idioma do áudio e legendas quando o conteúdo os tiver, para ver no idioma que prefiro.
- **CA:**
  1. Given hls.js com múltiplas faixas, Then o menu lista-as com idioma/nome e permite trocar sem reiniciar.
  2. Given nativo com `audioTracks`/`textTracks` (Safari), Then idem.
  3. Given ausência de faixas alternativas, Then o menu não aparece.
  4. Given preferência de idioma guardada, Then é aplicada automaticamente quando disponível.
- **Dependências:** PLY-02.
- **Testes:** stream HLS de teste com múltiplas faixas.

---

## E4 — TV em direto

### LIV-01 — Categorias e lista de canais
- **Prioridade:** Must · **Esforço:** 5 · **Valor:** Alto
- **História:** Como utilizador, quero ver os canais organizados por categorias, com logos, para encontrar rapidamente o que quero ver.
- **CA:**
  1. Given a fonte ativa, Then a lista de categorias inclui "Favoritos", "Recentes", "Todos" + categorias da fonte pela ordem original.
  2. Given 20 000 canais em "Todos", Then a lista é virtualizada e cumpre NFR-03.
  3. Given logo indisponível ou falhado (incl. mixed content), Then mostra iniciais com cor derivada do nome.
  4. Given navegação por teclado, Then setas movem seleção, `Enter` reproduz, `F`/`★` alterna favorito.
  5. Given categoria vazia, Then estado vazio.
- **Dependências:** FND-05, FND-04, UX-02, SRC-07 ou SRC-05 (dados).
- **Testes:** componente com 20k itens sintéticos; E2E de desempenho (traço Playwright).

### LIV-02 — Reproduzir canal e zapping
- **Prioridade:** Must · **Esforço:** 5 · **Valor:** Alto
- **História:** Como utilizador, quero tocar num canal e mudar rapidamente para o anterior/seguinte, para fazer zapping como numa TV.
- **CA:**
  1. Given um canal tocado, Then o leitor abre (mobile: topo; desktop: painel) e inicia a reprodução.
  2. Given `↑/↓`, botões ⏮/⏭ ou swipe vertical em ecrã inteiro, Then muda para o canal anterior/seguinte **dentro da categoria atual**, com o nome mostrado imediatamente.
  3. Given mudanças rápidas (5 em 2 s), Then só o último canal carrega (pedidos anteriores abortados).
  4. Given o painel "Canais" em ecrã inteiro, Then permite escolher canal sem sair do ecrã inteiro.
  5. Given a mudança de canal, Then é registada em "Recentes" (FAV-02).
- **Dependências:** LIV-01, PLY-02.
- **Testes:** E2E com 3 streams de teste; unit do controlador de zapping (abort/debounce).

### LIV-03 — Lembrar último canal e estado de navegação
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Médio
- **História:** Como utilizador, quero que a app abra onde a deixei, para retomar sem procurar outra vez.
- **CA:**
  1. Given saí da app no Direto › Desporto › canal X, When reabro, Then estou nessa categoria com o canal X selecionado e visível (scroll restaurado).
  2. Given opção "Reproduzir último canal ao abrir" (desligada por omissão, por respeito a dados móveis e autoplay), When ligada, Then inicia mudo se o browser bloquear autoplay com som, com botão "Ativar som".
  3. Given a fonte ativa foi removida, Then cai para Início sem erros.
- **Dependências:** LIV-02, FND-05.
- **Testes:** E2E (reload).

### LIV-04 — Filtro rápido de canais
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Alto
- **História:** Como utilizador, quero escrever parte do nome ou número de um canal e ver logo os resultados, para chegar a ele em segundos.
- **CA:**
  1. Given o campo de filtro na categoria atual, When escrevo "sport", Then a lista filtra em < 100 ms, ignorando maiúsculas e acentos.
  2. Given um número ("101"), Then dá prioridade ao canal com esse número.
  3. Given `Esc`, Then limpa o filtro.
- **Dependências:** LIV-01.
- **Testes:** unit da normalização; componente.

---

## E5 — Filmes (VOD)

### VOD-01 — Grelha de filmes por categoria
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero navegar pelos filmes por categoria com posters, para escolher o que ver.
- **CA:**
  1. Given a fonte ativa, Then categorias como chips/lista e grelha virtualizada de posters (2:3) com título e ano.
  2. Given ordenação (Recentes adicionados · A–Z · Rating quando existir), Then a grelha ordena sem recarregar da rede.
  3. Given posters em falta/falhados, Then placeholder tonal com título.
  4. Given "Continuar a ver" para filmes com progresso, Then barra de progresso no cartão.
- **Dependências:** FND-05, FND-04, UX-02, SRC-07.
- **Testes:** componente com 10k itens; E2E.

### VOD-02 — Detalhe do filme
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero ver sinopse, duração, ano, género e rating antes de reproduzir, para decidir se quero ver.
- **CA:**
  1. Given Xtream, When abro o detalhe, Then `get_vod_info` é pedido (cache 24 h) e os campos disponíveis são mostrados; os ausentes não deixam espaços vazios.
  2. Given texto vindo do servidor, Then é renderizado como texto (nunca HTML).
  3. Given "Reproduzir"/"Retomar a mm:ss", Then abre o leitor.
  4. Given falha do `get_vod_info`, Then mostra os dados básicos da lista e permite reproduzir.
- **Dependências:** VOD-01, PLY-02.
- **Testes:** unit do mapeamento; componente; MSW.

### VOD-03 — Reprodução VOD com retomar
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero continuar um filme onde parei, para não procurar o ponto manualmente.
- **CA:**
  1. Given reprodução VOD, Then a posição é guardada a cada 10 s, ao pausar, e ao sair (`pagehide`/`visibilitychange`).
  2. Given posição guardada entre 1 min e 95 % da duração, Then o detalhe mostra "Retomar a mm:ss" e "Começar do início".
  3. Given > 95 %, Then marca como visto e remove de "Continuar a ver".
  4. Given o servidor não suporta *range requests* (seek falha), Then aviso e reprodução desde o início.
- **Dependências:** VOD-02, FAV-02.
- **Testes:** unit da política; E2E com MP4 de teste.

### VOD-04 — Classificação de filmes/séries em fontes M3U
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Médio
- **História:** Como utilizador de uma lista M3U, quero que filmes e séries apareçam nas secções certas quando a lista o permite, para não ter tudo misturado na TV em direto.
- **CA:**
  1. Given URLs com `/movie/` ou `/series/` (padrão Xtream), Then classificados como filme/série.
  2. Given `group-title` com prefixos comuns ("VOD", "Movies", "Filmes", "Series", "Séries") ou extensões `.mp4/.mkv/.avi`, Then classificados com regras configuráveis.
  3. Given séries M3U com padrão `S01E02`/`S01 E02`/`1x02` no nome, Then agrupadas por série e temporada.
  4. Given classificação incerta, Then fica em Live (comportamento seguro) e a regra é documentada.
- **Dependências:** SRC-04.
- **Testes:** unit com tabela de exemplos (≥ 40 casos).

---

## E6 — Séries

### SER-01 — Grelha de séries
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Alto
- **História:** Como utilizador, quero navegar pelas séries por categoria, para encontrar o que seguir.
- **CA:** iguais a VOD-01 (CA1–3) aplicados a séries; cartão mostra nº de temporadas quando conhecido.
- **Dependências:** VOD-01 (reutiliza componentes de grelha).
- **Testes:** componente; E2E.

### SER-02 — Detalhe da série, temporadas e episódios
- **Prioridade:** Must · **Esforço:** 5 · **Valor:** Alto
- **História:** Como utilizador, quero ver os episódios organizados por temporada, para escolher o episódio certo.
- **CA:**
  1. Given Xtream, When abro a série, Then `get_series_info` é pedido (cache em `seriesDetails`, TTL 24 h) e mostra temporadas ordenadas e episódios por número.
  2. Given temporadas sem metadados, Then nomes "Temporada N".
  3. Given progresso de episódios, Then cada episódio mostra visto/em curso; a série mostra "Continuar T2 E5".
  4. Given M3U agrupado (VOD-04 CA3), Then mesma UI com dados locais.
  5. Given resposta malformada (episódios como objeto vs array — variação conhecida entre painéis), Then é normalizada.
- **Dependências:** SER-01, PLY-02.
- **Testes:** unit de normalização com fixtures de 3 variantes; componente.

### SER-03 — Reproduzir episódio, retomar e próximo episódio
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero que o próximo episódio seja proposto no fim, para ver uma série sem interrupções.
- **CA:**
  1. Given um episódio, Then retomar segue as regras de VOD-03.
  2. Given faltam ≤ 20 s (ou créditos não detetáveis: no `ended`), Then cartão "Próximo episódio em 10 s" com Cancelar; avança para a temporada seguinte quando aplicável.
  3. Given último episódio, Then não propõe nada.
- **Dependências:** SER-02, VOD-03.
- **Testes:** unit da lógica de próximo episódio; E2E com MP4 curtos.

---

## E7 — Guia de programação (EPG)

### EPG-01 — Agora/seguinte via Xtream
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero ver o programa atual e o seguinte de cada canal, para decidir o que ver.
- **CA:**
  1. Given o canal a reproduzir, Then mostra "Agora" (título, horas, barra de progresso) e "Depois" via `get_short_epg` (títulos base64 descodificados em UTF-8).
  2. Given a lista de canais, Then pede EPG apenas para linhas visíveis (máx. 6 pedidos concorrentes, debounce de scroll 300 ms, cache 5 min).
  3. Given ausência de EPG, Then nada é mostrado (sem "N/D" em todas as linhas).
  4. Given fusos, Then horas apresentadas no fuso do dispositivo (usar `start_timestamp`/`stop_timestamp`).
- **Dependências:** LIV-01, SRC-02.
- **Testes:** unit de descodificação/tempos; MSW.
- **Riscos:** alguns painéis limitam pedidos → respeitar 429 com backoff.

### EPG-02 — Importar EPG XMLTV
- **Prioridade:** Should · **Esforço:** 5 · **Valor:** Médio
- **História:** Como utilizador de M3U, quero que o EPG indicado na lista (ou um URL que eu forneça) seja carregado, para ver a programação.
- **CA:**
  1. Given `url-tvg` ou URL manual (`.xml` ou `.xml.gz`), Then descarrega em streaming, descomprime com `DecompressionStream` e faz parse SAX no worker.
  2. Given janela configurada (−2 h a +48 h), Then só esses programas são guardados.
  3. Given ficheiro de 100 MB descomprimido, Then UI responsiva e memória do worker < 200 MB (medido em desktop).
  4. Given refresh 12 h, Then programas terminados são expurgados.
  5. Given entidades XML e CDATA, Then texto correto; nunca interpretado como HTML.
- **Dependências:** FND-07, FND-05, EPG-03 (pode ser feita em paralelo com contrato acordado).
- **Testes:** unit do parser com fixtures; benchmark.

### EPG-03 — Correspondência canal ↔ EPG
- **Prioridade:** Should · **Esforço:** 3 · **Valor:** Médio
- **História:** Como utilizador, quero que a programação apareça no canal certo, para confiar no guia.
- **CA:**
  1. Given `tvg-id` igual a `channel@id`, Then correspondência exata.
  2. Given sem `tvg-id`, Then correspondência por nome normalizado (sem acentos, minúsculas, sem "HD/FHD/4K/+1", prefixos de país "PT:", "PT |").
  3. Given correspondência ambígua, Then não associa (evitar falsos positivos) e conta como "sem EPG".
  4. Given o diagnóstico, Then mostra % de canais com EPG.
  5. Given correção manual (opcional, Could), Then o utilizador pode associar um canal a um id EPG.
- **Dependências:** EPG-02 (interface), LIV-01.
- **Testes:** unit com tabela ≥ 50 pares.

### EPG-04 — Vista de grelha EPG
- **Prioridade:** Could · **Esforço:** 8 · **Valor:** Médio
- **História:** Como utilizador, quero uma grelha horária de vários canais, para planear o que ver.
- **CA:** grelha virtualizada em 2 eixos; linha "agora"; navegação por teclado; desempenho ≥ 55 fps com 500 canais × 24 h.
- **Dependências:** EPG-03.
- **Riscos:** complexidade elevada; dividir em sub-stories antes de iniciar.

---

## E8 — Pesquisa

### SCH-01 — Índice de pesquisa no worker
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero pesquisar entre milhares de itens instantaneamente, para encontrar qualquer canal, filme ou série.
- **CA:**
  1. Given o fim de uma sincronização, Then o índice MiniSearch (campos: nome normalizado; armazenados: key, type, categoria) é construído no worker e serializado em `searchIndex`.
  2. Given app reaberta, Then o índice é carregado de IndexedDB (sem reconstrução) em < 1 s para 100k itens (desktop médio).
  3. Given pesquisa por prefixo e com erro de 1 letra em termos ≥ 5 letras, Then encontra o item (fuzzy 0.2).
  4. Given NFR-04, Then cumprido.
- **Dependências:** FND-07, SRC-07/SRC-05.
- **Testes:** unit + benchmark.

### SCH-02 — Pesquisa global (UI)
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero um único campo de pesquisa que mostre canais, filmes e séries, para não ter de saber onde está o conteúdo.
- **CA:**
  1. Given `/` ou ícone 🔍, Then abre pesquisa com foco no campo.
  2. Given ≥ 2 caracteres, Then resultados agrupados por tipo (máx. 20 por grupo + "ver todos"), atualização com debounce 120 ms.
  3. Given um resultado, Then canal → reproduz; filme/série → detalhe.
  4. Given pesquisas recentes, Then últimas 10 guardadas localmente, com opção limpar.
  5. Given sem resultados, Then estado vazio.
- **Dependências:** SCH-01, FND-04.
- **Testes:** componente + E2E.

---

## E9 — Favoritos e histórico

### FAV-01 — Favoritos
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Alto
- **História:** Como utilizador, quero marcar canais, filmes e séries como favoritos, para os encontrar rapidamente.
- **CA:**
  1. Given um item, When toco ★ (ou tecla `F`), Then alterna favorito com feedback imediato (otimista) e anúncio para leitores de ecrã.
  2. Given re-sincronização, Then favoritos persistem; itens que deixaram de existir aparecem como "indisponível" com opção remover.
  3. Given favoritos por fonte, Then só os da fonte ativa aparecem.
- **Dependências:** FND-05.
- **Testes:** unit repo; componente.

### FAV-02 — Histórico e "continuar a ver"
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Alto
- **História:** Como utilizador, quero ver os canais que vi recentemente e o que estava a ver, para voltar com um toque.
- **CA:**
  1. Given um canal reproduzido > 5 s, Then entra em "Recentes" (máx. 30, mais recente primeiro, sem duplicados).
  2. Given VOD/episódios com progresso, Then aparecem em "Continuar a ver" (máx. 20).
  3. Given "Limpar histórico", Then remove histórico (não favoritos).
- **Dependências:** FND-05.
- **Testes:** unit repo.

### FAV-03 — Ecrã Favoritos e Início
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero um ecrã inicial com o que continuo a ver, recentes e favoritos, para começar a ver em um toque.
- **CA:**
  1. Given dados, Then Início mostra secções "Continuar a ver", "Canais recentes", "Favoritos" (cada uma escondida se vazia).
  2. Given ecrã Favoritos, Then separadores Canais/Filmes/Séries.
  3. Given nenhum dado, Then estado vazio com atalhos.
- **Dependências:** FAV-01, FAV-02, LIV-02, VOD-01, SER-01.
- **Testes:** componente; E2E.

---

## E10 — PWA

### PWA-01 — Manifesto, ícones e instalabilidade
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Alto
- **História:** Como utilizador, quero instalar a app no ecrã inicial, para a abrir como uma app normal.
- **CA:**
  1. Given o manifesto, Then tem `name`, `short_name`, `start_url` e `scope` coerentes com o `base` do Pages, `display: standalone`, `theme_color`/`background_color` dos tokens, ícones 192/512 + `maskable`, `screenshots` (mobile e desktop).
  2. Given iOS, Then `apple-touch-icon`, `apple-mobile-web-app-*` meta e splash razoável.
  3. Given Chrome/Edge, When elegível, Then botão "Instalar app" em Definições usa `beforeinstallprompt`; em iOS mostra instruções "Partilhar → Adicionar ao ecrã principal".
  4. Given Lighthouse, Then critérios de instalabilidade cumpridos.
- **Dependências:** FND-01.
- **Testes:** Lighthouse CI (QA-03); manual iOS/Android.

### PWA-02 — Service worker e estratégia de cache
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero que a app abra rapidamente mesmo sem rede, para consultar favoritos e definições.
- **CA:**
  1. Given o build, Then o SW (vite-plugin-pwa, `generateSW`) faz precache do app shell (HTML, JS, CSS, fontes, ícones).
  2. Given pedidos para outros hosts (API, streams, imagens, EPG), Then `NetworkOnly`/sem interceção — **nenhum URL com credenciais entra no Cache Storage** (teste automatizado lista `caches` após sessão E2E).
  3. Given navegação offline, Then a app abre e mostra dados do IndexedDB.
- **Dependências:** PWA-01.
- **Testes:** E2E Playwright com `context.setOffline(true)`; inspeção de caches.

### PWA-03 — Atualizações previsíveis
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Médio
- **História:** Como utilizador, quero ser avisado quando há uma nova versão e escolher quando atualizar, para não perder a reprodução em curso.
- **CA:**
  1. Given nova versão detetada, Then snackbar "Nova versão disponível — Atualizar".
  2. Given reprodução em curso, Then a atualização nunca é aplicada automaticamente.
  3. Given "Atualizar", Then `skipWaiting` + reload, preservando a rota.
  4. Given migração de IndexedDB numa nova versão, Then corre antes da UI e com indicador.
- **Dependências:** PWA-02.
- **Testes:** E2E com dois builds (versões simuladas).

### PWA-04 — Estado offline e erros de rede
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Médio
- **História:** Como utilizador, quero saber quando estou sem ligação, para perceber porque não consigo reproduzir.
- **CA:**
  1. Given `navigator.onLine=false` ou falhas consecutivas, Then faixa "Sem ligação" persistente; ações de rede desativadas com explicação.
  2. Given regresso da ligação, Then faixa desaparece e tarefas pendentes (sync agendada) retomam.
  3. Given a app, Then nunca promete reprodução offline.
- **Dependências:** UX-02.
- **Testes:** E2E offline.

### PWA-05 — Armazenamento persistente e quota
- **Prioridade:** Must · **Esforço:** 1 · **Valor:** Médio
- **História:** Como utilizador, quero que o browser não apague os meus dados, para não ter de reconfigurar a app.
- **CA:**
  1. Given a primeira fonte adicionada, Then `navigator.storage.persist()` é pedido e o resultado mostrado em Definições › Armazenamento, com espaço usado (`estimate()`).
  2. Given iOS não instalado, Then aviso "Instala a app para evitar que o Safari apague os dados após 7 dias sem uso".
- **Dependências:** FND-05.
- **Testes:** unit com APIs mockadas.

---

## E11 — UX transversal e acessibilidade

### UX-01 — Onboarding de primeiro uso
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Alto
- **História:** Como novo utilizador, quero ser guiado para adicionar a minha primeira fonte, para começar sem ler instruções.
- **CA:**
  1. Given nenhuma fonte, Then qualquer rota principal redireciona para onboarding (exceto Definições/Privacidade).
  2. Given o ecrã, Then mostra as 3 opções de `UX_UI.md §4.1` e a nota "não incluímos canais / dados ficam no dispositivo".
  3. Given conclusão, Then `onboardingDone` e redireciona para Início.
- **Dependências:** FND-04.
- **Testes:** E2E.

### UX-02 — Componentes de estado e feedback
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero sempre perceber o que a app está a fazer, para confiar nela.
- **CA:**
  1. Given `StateView` (loading/skeleton, empty, error, offline) e `Toast`, Then usados por todas as features (sem variantes ad hoc).
  2. Given loading < 300 ms, Then nada pisca.
  3. Given erro, Then mensagem + ação + "Detalhes" (redigidos).
- **Dependências:** FND-03.
- **Testes:** componente + axe.

### UX-03 — Navegação por teclado e auditoria de acessibilidade
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador de teclado ou leitor de ecrã, quero usar todas as funções principais, para não depender do rato ou toque.
- **CA:**
  1. Given os fluxos adicionar fonte → ver canal → mudar canal → abrir filme → pesquisar, Then completáveis só com teclado (teste E2E).
  2. Given axe em todas as rotas, Then 0 violações serious/critical.
  3. Given skip link "Saltar para conteúdo", Then presente.
  4. Given NVDA/VoiceOver (manual), Then fluxo de zapping anunciado corretamente.
- **Dependências:** LIV-02, VOD-02, SCH-02, SRC-03.
- **Testes:** E2E axe; checklist manual.

### UX-04 — Definições, privacidade e "sobre"
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Médio
- **História:** Como utilizador, quero um ecrã de definições simples, para ajustar tema, comportamento e consultar privacidade.
- **CA:**
  1. Given Definições, Then secções: Fontes · Aparência (tema) · Reprodução (ecrã inteiro em paisagem, reproduzir último canal, formato live preferido Auto/TS/HLS) · Armazenamento · Privacidade (o que guardamos, apagar dados) · Sobre (versão, licenças open source, aviso legal).
  2. Given "Licenças", Then lista gerada no build a partir das dependências.
  3. Given aviso legal, Then "A app não fornece conteúdos; usa apenas fontes que tens autorização para aceder".
- **Dependências:** FND-04, SRC-08.
- **Testes:** componente.

### UX-05 — Navegação D-pad / comando de TV
- **Prioridade:** Should · **Esforço:** 5 · **Valor:** Médio
- **História:** Como utilizador numa TV ou box Android, quero navegar com as setas do comando, para usar a app no sofá.
- **CA:** foco espacial em grelhas e listas; tecla "voltar" do comando; foco nunca se perde; teclas de canal (`ChannelUp/ChannelDown`) suportadas.
- **Dependências:** UX-03.

---

## E12 — Segurança e privacidade

### SEC-01 — CSP, validação de URLs e sanitização
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como utilizador, quero que listas ou metadados maliciosos não consigam executar código na app, para proteger as minhas credenciais.
- **CA:**
  1. Given `index.html`, Then `<meta http-equiv="Content-Security-Policy">` com `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` (Emotion), `img-src * data: blob:`, `media-src * blob:`, `connect-src *` (necessário: servidores do utilizador), `worker-src 'self' blob:`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`.
  2. Given qualquer URL externo (fonte, logo, stream, EPG), Then validado: só `http:`/`https:`; rejeita credenciais em `userinfo` exceto quando necessário e nunca mostra-as.
  3. Given metadados (nomes, sinopses), Then renderizados como texto; lint proíbe `dangerouslySetInnerHTML` (regra ESLint).
  4. Given links externos (ex.: trailer YouTube em VOD info), Then `rel="noopener noreferrer"` e confirmação.
  5. Given `Referrer-Policy`, Then `<meta name="referrer" content="no-referrer">` para não vazar a origem da app para servidores IPTV.
- **Dependências:** FND-01.
- **Testes:** unit de validação; E2E com M3U contendo payloads XSS (`<img onerror>`, `javascript:`).

### SEC-02 — Palavra-passe mestra (bloqueio)
- **Prioridade:** Should · **Esforço:** 5 · **Valor:** Médio
- **História:** Como utilizador preocupado com privacidade, quero proteger as credenciais com uma palavra-passe que só eu sei, para que quem pegue no dispositivo não as possa usar.
- **CA:** PBKDF2-SHA-256 ≥ 600k iterações + salt; chave nunca persistida; re-cifra de todos os segredos ao ativar/desativar; bloqueio ao abrir e após N min em segundo plano; sem recuperação (aviso explícito).
- **Dependências:** SRC-01.

### SEC-03 — Controlo parental com PIN
- **Prioridade:** Could · **Esforço:** 3 · **Valor:** Baixo
- **História:** Como pai/mãe, quero ocultar categorias com PIN, para limitar o acesso de crianças.
- **CA:** categorias marcadas exigem PIN; PIN guardado como hash; aviso de que é um dissuasor, não uma proteção forte.
- **Dependências:** LIV-01, VOD-01.

---

## E13 — Qualidade e publicação

### QA-01 — Fixtures, mocks e streams de teste
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Médio (habilitador)
- **História:** Como programador, quero dados e streams de teste sintéticos e legais, para testar sem depender de fornecedores reais.
- **CA:**
  1. Given `fixtures/`, Then: respostas Xtream (3 variantes de painel), M3U (pequena, malformada, 50k gerada), XMLTV (pequeno, gz), payloads maliciosos.
  2. Given streams de teste, Then gerados localmente (ffmpeg em CI ou ficheiros pequenos commitados < 2 MB): HLS H.264/AAC, HLS multi-áudio, TS H.264/AAC, TS com AC-3 (para testar erro), MP4 curto; servidos por servidor local com CORS configurável (ligado/desligado).
  3. Given handlers MSW, Then partilhados entre Vitest e Playwright.
  4. Given nenhuma fixture, Then contém dados reais de fornecedores.
- **Dependências:** FND-01.
- **Riscos:** ffmpeg não instalado localmente (verificar; alternativa: gerar em CI ou commitar ficheiros pequenos com licença própria).

### QA-02 — E2E Playwright + axe
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como mantenedor, quero testes de ponta a ponta nos fluxos críticos em Chromium, WebKit e Firefox, para garantir que nada parte entre versões.
- **CA:**
  1. Given o CI, Then corre smoke E2E (onboarding Xtream mock → live → zapping → filme → pesquisa → favoritos → apagar dados) em Chromium, WebKit e Firefox, viewports mobile e desktop.
  2. Given cada rota, Then axe sem violações serious/critical.
  3. Given falha, Then traços e vídeos guardados como artefactos.
- **Dependências:** FND-02, QA-01 (fluxos completos dependem das features — a suite cresce com elas).

### QA-03 — Orçamentos de desempenho (Lighthouse CI)
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Médio
- **História:** Como utilizador, quero uma app que abre depressa no telemóvel, para não esperar.
- **CA:**
  1. Given Lighthouse CI (mobile), Then Performance ≥ 90, A11y ≥ 95, Best Practices ≥ 95; falha o CI abaixo disso.
  2. Given `size-limit` (ou equivalente), Then JS inicial ≤ 200 KB gz; chunk hls ≤ 150 KB gz; mpegts ≤ 80 KB gz.
  3. Given relatório, Then publicado como artefacto do CI.
- **Dependências:** FND-02, FND-03.

### DEP-01 — Deploy para GitHub Pages
- **Prioridade:** Must · **Esforço:** 2 · **Valor:** Alto
- **História:** Como utilizador, quero aceder à app por um endereço HTTPS público, para a usar e instalar em qualquer dispositivo.
- **CA:**
  1. Given push para `main` com CI verde, Then workflow publica `dist/` via `actions/deploy-pages`.
  2. Given o URL `https://<user>.github.io/<repo>/`, Then app, SW e manifesto funcionam com o `base` correto.
  3. Given falha no deploy, Then versão anterior mantém-se.
- **Dependências:** FND-02, PWA-01. **Requer aprovação explícita do utilizador (publicação).**
- **Testes:** smoke E2E contra o URL publicado (job separado).

### DEP-02 — Validação manual em dispositivos
- **Prioridade:** Must · **Esforço:** 3 · **Valor:** Alto
- **História:** Como dono do produto, quero confirmar o comportamento real em Android, iOS e desktop, para não declarar compatibilidade sem prova.
- **CA:**
  1. Given a checklist de `TEST_PLAN.md §5`, Then executada em: Android (Chrome), iPhone (Safari + PWA instalada), desktop (Chrome, Firefox, Safari se disponível).
  2. Given resultados, Then `docs/progress/compatibility-matrix.md` atualizado com data, versão do SO/browser e resultado.
- **Dependências:** release candidate do MVP.

---

## E14 — Pós-MVP / experimental

### EXP-01 — Exportar/importar configurações
- **Prioridade:** Should · **Esforço:** 3 · **Valor:** Médio
- **História:** Como utilizador com vários dispositivos, quero exportar fontes, favoritos e definições para um ficheiro e importá-lo noutro dispositivo, para não reconfigurar tudo.
- **CA:** ficheiro JSON versionado; segredos incluídos só se o utilizador definir uma palavra-passe de exportação (AES-GCM + PBKDF2); importação com pré-visualização e fusão/substituição; validação de schema (ficheiro não confiável).
- **Dependências:** SRC-08, FAV-03.

### PRX-01 — Proxy self-hosted de referência
- **Prioridade:** Could (pode subir para Must — ADR-010) · **Esforço:** 5 · **Valor:** Alto se o fornecedor for HTTP-only
- **História:** Como utilizador cujo fornecedor só tem HTTP, quero indicar o meu próprio proxy, para conseguir reproduzir no browser.
- **CA:**
  1. Given Definições › Proxy pessoal (URL HTTPS + token), Then `UrlRewriter` reescreve pedidos (API, playlists, segmentos, streams) para o proxy.
  2. Given o projeto, Then inclui `proxy/` com implementação mínima (Node, sem dependências) com: allowlist de hosts configurada pelo dono, token obrigatório, sem logs de URLs, streaming sem buffer, reescrita de playlists HLS.
  3. Given documentação, Then guia para expor via HTTPS (ex.: Tailscale Serve) e avisos de segurança (SSRF, abertura à internet).
- **Dependências:** PLY-01, SRC-02, ADR-010.

### NAT-01 — Shell Android (Capacitor) — experimental
- **Prioridade:** Could · **Esforço:** 8 (dividir antes de iniciar) · **Valor:** Alto para utilizadores Android com fornecedores HTTP-only
- **História:** Como utilizador Android, quero uma APK que use a mesma app sem as restrições do browser, para reproduzir fornecedores HTTP-only.
- **CA:** mesma base de código; `CapacitorHttp` para API; cleartext permitido apenas para hosts do utilizador; build APK via GitHub Actions; sem Play Store no início.
- **Dependências:** MVP completo.

### PRF-01 — Perfis múltiplos
- **Prioridade:** Could · **Esforço:** 5 · **Valor:** Baixo/Médio
- **CA:** favoritos, histórico e preferências por perfil; fontes partilhadas; seleção de perfil ao abrir (opcional).

### CST-01 — Remote Playback / Cast — experimental
- **Prioridade:** Could · **Esforço:** 5 · **Valor:** Médio
- **CA:** botão AirPlay (Safari, engine nativa) e Remote Playback API onde suportado; Cast SDK só após avaliação de requisitos (streams têm de ser acessíveis pelo recetor).

### MSS-01 — Media Session
- **Prioridade:** Should · **Esforço:** 1 · **Valor:** Baixo
- **CA:** título/artwork no ecrã de bloqueio e controlos play/pausa/anterior/seguinte onde suportado.
