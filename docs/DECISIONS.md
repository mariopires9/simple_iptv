# Registo de decisões arquiteturais (ADR)

Formato curto: contexto → decisão → alternativas → consequências. Estados: **Aceite**, **Proposta** (precisa de aprovação), **Pendente** (depende de dados), **Substituída**.
Qualquer alteração a uma decisão Aceite exige um novo ADR que a substitua — nenhum agente altera arquitetura sem ADR (ver `AGENT_WORKFLOW.md`).

| ID | Título | Estado |
|---|---|---|
| ADR-001 | Aplicação 100% client-side, sem backend no MVP | **Aceite** (2026-10-28) |
| ADR-002 | React + TypeScript + Vite (não Next.js) | **Aceite** (2026-10-28) |
| ADR-003 | MUI com tema próprio | **Aceite** (2026-10-28) |
| ADR-004 | IndexedDB via Dexie como única persistência | **Aceite** (2026-10-28) |
| ADR-005 | Engines de reprodução: nativo + hls.js + mpegts.js, carregados sob demanda | **Aceite** (2026-10-28) |
| ADR-006 | Proteção de credenciais com WebCrypto (chave de dispositivo; palavra-passe mestra opcional pós-MVP) | **Aceite** (2026-10-28) |
| ADR-007 | GitHub Pages + HashRouter | **Aceite** (2026-10-28) |
| ADR-008 | Estado: Zustand (UI) + TanStack Query (remoto) + Dexie (persistido) | **Aceite** (2026-10-28) |
| ADR-009 | Trabalho pesado em Web Workers (parse M3U/JSON/XMLTV, índice MiniSearch) | **Aceite** (2026-10-28) |
| ADR-010 | Estratégia para servidores HTTP-only/sem CORS | **Pendente (spike S-00)** |
| ADR-011 | Zero telemetria, zero analytics, zero publicidade | **Aceite** (2026-10-28) |
| ADR-012 | UI em pt-PT com strings externalizadas (pronta para i18n) | **Aceite** (2026-10-28) |
| ADR-013 | Validação de dados externos com schemas tolerantes (Valibot) | **Aceite** (2026-10-28) |
| ADR-014 | Listas guardadas só no dispositivo, sem sincronização | **Aceite** (2026-10-28) |

---

### ADR-001 — Client-side sem backend
- **Contexto:** custo ~0, privacidade, credenciais do utilizador.
- **Decisão:** SPA estática. Todas as chamadas (Xtream, M3U, EPG, streams) saem do browser do utilizador para o servidor IPTV.
- **Alternativas:** backend próprio (proxy/API) — rejeitado no MVP: custo, responsabilidade sobre credenciais e tráfego de vídeo, riscos de termos de serviço. Vercel Functions e Supabase também avaliados e rejeitados para o MVP (`RESEARCH.md §10.1`); Supabase fica como candidato se a sincronização entre dispositivos vier a ser pedida.
- **Consequências:** a app depende de o servidor IPTV suportar HTTPS e CORS (ver ADR-010). Não há sincronização entre dispositivos (substituída por exportar/importar, pós-MVP).

### ADR-002 — React + TS + Vite
- **Decisão:** React 19, TypeScript `strict`, Vite 8.
- **Alternativas:** Next.js (sem vantagem: sem SEO, sem SSR útil, conteúdo privado); Svelte/Solid (menores, mas menor ecossistema de componentes acessíveis e menor familiaridade).
- **Consequências:** code-splitting por rota; engines de vídeo em chunks separados.

### ADR-003 — MUI com tema próprio
- **Decisão:** MUI v9; tokens próprios (`UX_UI.md`); imports por caminho; ripple desativado globalmente; superfícies tonais.
- **Alternativa:** Radix + Tailwind. Gatilho de reavaliação: bundle inicial > 200 KB gz após FND-03.
- **Consequências:** acessibilidade de base garantida (focus, ARIA); custo de bundle a vigiar em QA-03.

### ADR-004 — Dexie
- **Decisão:** uma base `simple-iptv` com tabelas versionadas (ver `ARCHITECTURE.md §5`). Preferências também em IndexedDB para que "apagar tudo" seja um único `db.delete()` + limpeza de caches.
- **Alternativa:** `idb` (mais leve, mas índices/migrações manuais).

### ADR-005 — Engines de reprodução
- **Decisão:** interface `PlayerEngine` com três implementações: `NativeEngine`, `HlsEngine` (hls.js), `MpegtsEngine` (mpegts.js). Seleção por `selectEngine(descriptor, capabilities)`; hls.js e mpegts.js carregados com `import()` apenas quando necessários.
- **Alternativas:** Video.js/Shaka — peso e funcionalidades (DASH/DRM) não necessários.
- **Consequências:** codecs continuam limitados pelo dispositivo; DRM fora de âmbito.

### ADR-006 — Credenciais
- **Decisão (MVP):** palavra-passe Xtream e URLs M3U (que normalmente contêm credenciais) cifradas com AES-GCM; a chave é uma `CryptoKey` **não exportável** gerada por WebCrypto e guardada em IndexedDB.
- **O que protege:** cópia/inspeção casual da base de dados, exportações de dados, backups do perfil sem a chave.
- **O que NÃO protege:** código malicioso a correr na mesma origem (XSS), quem tem acesso ao dispositivo desbloqueado, extensões do browser, a própria URL do stream (as credenciais Xtream fazem parte do caminho do stream e ficam visíveis no separador Rede).
- **Pós-MVP (SEC-02):** palavra-passe mestra (PBKDF2-SHA-256 ≥ 600 000 iterações → chave AES-GCM não persistida), pedida ao abrir a app.

### ADR-007 — GitHub Pages + HashRouter — Aceite (2026-10-28, confirmado pelo utilizador após avaliação de Vercel/Supabase)
- **Decisão:** deploy por GitHub Actions para Pages; `HashRouter` (ou `createHashRouter`) para evitar 404 em deep links sem fallback de servidor; `base` do Vite = `/<repo>/`.
- **Alternativa:** Cloudflare Pages (headers custom, SPA fallback) — a adotar se for necessário `Content-Security-Policy` por header ou proxy em Workers.
- **Consequências:** CSP apenas via `<meta>` (sem `frame-ancestors`); repo público no plano Free.

### ADR-008 — Gestão de estado
- **Decisão:** dados persistidos (catálogo, favoritos, histórico) lidos do Dexie via hooks (`useLiveQuery`); dados remotos não persistidos (detalhe de VOD, EPG curto) via TanStack Query com `staleTime`; estado efémero de UI (leitor, overlays, filtros) em Zustand.
- **Alternativa:** Redux Toolkit — mais cerimónia, sem ganho.

### ADR-009 — Web Workers
- **Decisão:** um worker de dados (Comlink, Apache-2.0) que faz: download+parse M3U em streaming, `fetch`+`JSON.parse` de respostas Xtream grandes, normalização, `bulkPut` no Dexie, construção do índice MiniSearch, parse XMLTV.
- **Consequência:** a UI nunca bloqueia > 50 ms durante sincronizações.

### ADR-010 — Servidores HTTP-only / sem CORS — **PENDENTE**
- **Contexto:** ver `RESEARCH.md §6`. É o maior risco do produto.
- **Proposta:** MVP em "modo direto" com diagnóstico explícito (SRC-09) e um ponto de extensão `UrlRewriter` (identidade no MVP). Pós-MVP: proxy self-hosted de referência (PRX-01) e/ou shell Android Capacitor (NAT-01).
- **Decisão depende de:** resultado do spike S-00 com o fornecedor real (HTTPS? CORS? `.m3u8` disponível? codecs?). Se o fornecedor do utilizador for HTTP-only sem CORS, o MVP em modo direto **não reproduzirá** os seus canais e PRX-01 ou NAT-01 passam a obrigatórios.

### ADR-011 — Sem telemetria
- Sem analytics, sem trackers, sem fontes de CDN de terceiros (fontes tipográficas auto-alojadas), sem relatórios de erros remotos. Logs só na consola e num buffer local redigido, exportável manualmente.

### ADR-012 — Idioma
- UI em português (Portugal); strings por feature em `src/i18n/pt-PT/<feature>.ts` para permitir outros idiomas mais tarde sem refactor.

### ADR-013 — Validação de dados externos
- **Decisão:** Valibot (MIT, ~1–2 KB por schema, tree-shakeable) com schemas tolerantes (coerção de números em string, campos opcionais) para respostas Xtream; dados inválidos são descartados item a item, não a resposta inteira.
- **Alternativa:** Zod (maior), validação manual (frágil).

### ADR-014 — Listas só no dispositivo — Aceite (2026-10-28, decisão do utilizador)
- **Contexto:** o utilizador quer uma página com várias listas IPTV guardadas (SRC-08). Foi avaliado se as listas devem aparecer em vários dispositivos.
- **Decisão:** as listas e as credenciais ficam apenas no dispositivo onde foram adicionadas (IndexedDB, credenciais cifradas — ADR-006). Sem conta, sem servidor e sem sincronização.
- **Alternativas rejeitadas (por agora):** exportar/importar por ficheiro (EXP-01, mantém-se pós-MVP); sincronização via Supabase com cifra no cliente.
- **Consequências:** cada dispositivo é configurado à parte; "Apagar todos os dados" remove tudo. Reavaliar se o utilizador passar a usar vários dispositivos.
