# Investigação técnica e limitações dos browsers

> Fase 1 do planeamento. Data da investigação: 2026-10-28.
> Versões confirmadas no registo npm nesta data (servem de referência, não de compromisso; serão fixadas no `package-lock.json` na story FND-01).

| Pacote | Versão atual | Licença | Uso previsto |
|---|---|---|---|
| react | 19.3.1 | MIT | UI |
| vite | 8.3.5 | MIT | build/dev server |
| vite-plugin-pwa | 2.0.0 | MIT | manifesto + service worker (Workbox) |
| @mui/material | 9.5.0 | MIT | componentes |
| react-router | 8.5.1 | MIT | routing |
| dexie | 4.4.7 | Apache-2.0 | IndexedDB |
| zustand | 5.0.16 | MIT | estado de UI |
| @tanstack/react-query | 5.105.0 | MIT | cache de pedidos remotos |
| @tanstack/react-virtual | 3.14.23 | MIT | listas virtualizadas |
| hls.js | 1.7.3 | Apache-2.0 | HLS via MSE/MMS |
| mpegts.js | 1.8.2 | Apache-2.0 | MPEG-TS/FLV via MSE/MMS |
| minisearch | 7.2.0 | MIT | índice de pesquisa |
| vitest | 5.0.5 | MIT | testes unitários |
| @playwright/test | 1.64.1 | Apache-2.0 | E2E |

Verificado diretamente no código publicado: **hls.js 1.7.3 e mpegts.js 1.8.2 contêm caminhos para `ManagedMediaSource`** (API do Safari 17.1+ que substitui a MSE no iPhone). Isto torna a reprodução via MSE *possível* no iPhone, mas **não está validada em dispositivo** — é um item do spike S-00.

---

## 1. Ambiente atual (Fase 0)

| Item | Estado |
|---|---|
| Diretório `/home/academy/projects/simple_iptv` | Vazio; não é repositório git |
| CLAUDE.md / `.claude/` do projeto | Inexistentes |
| Agentes personalizados | Nenhum (apenas os incorporados: general-purpose, Explore, Plan) |
| Skills úteis disponíveis | `code-review`, `security-review`, `simplify`, `run`, `init` |
| MCPs úteis | Nenhum relevante para o projeto (os existentes são de produtividade empresarial) |
| Node / npm | v24.18.0 / 11.16.0 |
| git / gh | 2.43.0 / 2.45.0 — **`gh` não autenticado** |
| Browsers para E2E | Nenhum instalado (Playwright terá de descarregar Chromium/WebKit/Firefox na execução) |
| Docker | Indisponível |
| SO | Linux (WSL2) |

Consequências: projeto *greenfield*; sem convenções a herdar; o fluxo de agentes tem de usar apenas o que existe (ver `AGENT_WORKFLOW.md`); testes em WebKit (proxy para Safari) são possíveis via Playwright, mas **não substituem testes em iPhone real**.

---

## 2. Frameworks

| Critério | React + TS + Vite (SPA) | Next.js (export estático ou SSR) |
|---|---|---|
| Custo | 0 € — ficheiros estáticos | 0 € em export estático; SSR exige runtime (Vercel/Workers) |
| Desempenho | Excelente; code-splitting por rota; sem hidratação | SSR/RSC não traz ganho: o conteúdo depende de credenciais locais e não é indexável |
| Complexidade | Baixa | Maior (RSC, fronteiras server/client, `output: 'export'` perde funcionalidades) |
| Manutenção | Simples | Atualizações mais disruptivas |
| Segurança | Credenciais nunca saem do browser | Um servidor convidaria a usar API routes como proxy → passa a tocar em credenciais |
| Sem backend | Natural | Contra-natura |
| PWA | `vite-plugin-pwa` maduro | Possível mas menos direto |

**Conclusão:** React + TypeScript + Vite. Next.js não tem vantagem concreta para um leitor client-side cujo conteúdo é privado e por utilizador.

## 3. Biblioteca de componentes

| Critério | MUI (Material UI) v9 | Radix Primitives + Tailwind (estilo shadcn) | Mantine |
|---|---|---|---|
| Cobertura (listas, tabs, dialogs, nav, snackbars, sliders) | Completa | Primitivas; muitos componentes feitos à mão | Completa |
| Acessibilidade | Boa, testada | Muito boa (primitivas) | Boa |
| Identidade própria | Requer tema forte para não parecer "Material" | Total | Média |
| Peso | Maior (Emotion runtime) — mitigável com imports por caminho | Menor | Médio |
| Velocidade de entrega | Alta | Média | Alta |

**Recomendação:** MUI com tema personalizado (tokens próprios, sem *ripple* exagerado, sem sombras Material, superfícies tonais). Alternativa: Radix + Tailwind, se o orçamento de bundle (≤ 200 KB gz inicial) não for cumprido com MUI — o critério está em QA-03.

## 4. Persistência local

| Opção | Prós | Contras | Decisão |
|---|---|---|---|
| `localStorage` | Simples | Síncrono, ~5 MB, só strings | Apenas preferências triviais? Não — tudo em IndexedDB para ter um único ponto de "apagar dados" |
| IndexedDB via `idb` | Fino (~1 KB) | Índices, migrações e bulk à mão | Alternativa |
| **IndexedDB via Dexie** | Índices compostos, `bulkPut` rápido, migrações versionadas, `liveQuery` | ~25 KB gz | **Escolhido**: catálogos de 10k–100k+ itens precisam de bulk e índices |
| OPFS | Rápido para blobs | Não é base de dados | Não necessário |

Notas: o Safari apaga armazenamento de sites **não instalados** após 7 dias sem interação; apps adicionadas ao ecrã inicial estão isentas. Pedir `navigator.storage.persist()` após a primeira fonte.

## 5. Reprodução de vídeo

### 5.1 Formatos típicos de fornecedores IPTV

| Conteúdo | Formato habitual | Engine no browser |
|---|---|---|
| Live (Xtream) | `/live/u/p/ID.ts` (MPEG-TS contínuo) ou `.m3u8` se o painel permitir | mpegts.js (TS) ou hls.js/nativo (HLS) |
| Live (M3U genérico) | HLS `.m3u8` ou TS | idem |
| VOD | `.mp4`, `.mkv`, por vezes `.avi` | `<video>` nativo |
| Séries | idem VOD | idem |

### 5.2 Engines

| Engine | Suporta | Requisitos | Limitações |
|---|---|---|---|
| `<video>` nativo | MP4/WebM em todos; HLS nativo no Safari (macOS/iOS) e Chrome Android recente | Nenhum CORS para reprodução simples | Sem TS cru; MKV só "de facto" no Chrome |
| hls.js | HLS em browsers com MSE/MMS | **CORS** em playlists e segmentos (usa fetch/XHR) | Codec continua a depender do dispositivo |
| mpegts.js | MPEG-TS e FLV live via MSE/MMS | **CORS** + streaming fetch | Áudio MP2/AC-3 frequentemente não suportado pela MSE (a validar) |
| Shaka / Video.js | DASH, DRM | — | DASH/DRM fora de âmbito; Video.js acrescentaria peso sem ganho |

**Regra de seleção (a implementar em PLY-01):**
1. HLS no Safari/iOS → nativo primeiro (não exige CORS, AirPlay, melhor bateria); senão hls.js.
2. TS → mpegts.js se `isSupported()`; senão, para Xtream, tentar a variante `.m3u8` se `allowed_output_formats` a incluir.
3. MP4/WebM/MOV → nativo. MKV → nativo com mensagem clara em caso de falha. AVI e outros → "formato não suportado pelo browser".

### 5.3 Codecs (dependem do dispositivo — **não garantidos**)

| Codec | Chrome/Edge | Firefox | Safari |
|---|---|---|---|
| H.264 + AAC | Sim | Sim | Sim |
| HEVC/H.265 | Só com descodificação por hardware | Limitado | Sim |
| AC-3 / E-AC-3 (Dolby) | Não (Chrome); Edge depende do SO | Não | Sim |
| MP2 (comum em DVB) | Não via MSE | Não | Não |

Consequência: canais com áudio AC-3/MP2 podem reproduzir **vídeo sem som** no Chrome. A app deve detetar via `MediaSource.isTypeSupported`/eventos de erro e informar o utilizador; não é possível corrigir sem transcodificação (fora de âmbito).

## 6. Restrições críticas do browser (o fator decisivo)

### 6.1 Mixed content
Uma PWA **tem** de ser servida por HTTPS (service worker exige contexto seguro). A maioria dos servidores Xtream/IPTV serve **apenas HTTP**. Num página HTTPS:
- `fetch`/XHR para `http://` → **bloqueado** (API Xtream, playlists HLS via hls.js, mpegts.js).
- `<video src="http://...">` → o Chrome/Firefox fazem *auto-upgrade* para `https://`; se o servidor não tiver HTTPS, **falha**.
- Imagens `http://` (logos/posters) → auto-upgrade; falham sem HTTPS → mostrar fallback.

### 6.2 CORS
Mesmo com HTTPS, o servidor tem de devolver `Access-Control-Allow-Origin` para: `player_api.php`, download de M3U por URL, XMLTV, playlists e segmentos HLS (hls.js), streams TS (mpegts.js). Muitos painéis não o fazem. **Exceções:** reprodução direta em `<video>` (MP4, HLS nativo do Safari) e importação de ficheiro M3U local.

### 6.3 Outras
| Tema | Realidade |
|---|---|
| Cabeçalhos | O browser **não permite definir `User-Agent`** nem `Referer` arbitrários; fornecedores que exigem UA específico não funcionarão |
| Redirecionamentos | Streams Xtream redirecionam (302) para outros hosts; CORS e HTTPS aplicam-se também ao destino |
| Autoplay | Com som só após gesto do utilizador; zapping por toque/tecla conta como gesto |
| Ecrã inteiro | iPhone: só `webkitEnterFullscreen()` no `<video>` (controlos nativos, overlay próprio perde-se); iPad/Android/desktop: Fullscreen API |
| Segundo plano | Vídeo pausa ou é suspenso quando a app sai de foco em iOS; não prometer áudio em segundo plano. PiP disponível no Safari e Chrome |
| Rede local | Chrome 141/142+ exige permissão *Local Network Access* para pedidos de sites públicos a IPs privados (relevante para um proxy caseiro) |
| Cache do SW | Respostas *opaque* (imagens sem CORS) ocupam ~7 MB de quota cada no Chrome → **não** fazer cache de imagens opacas no SW |
| DRM | Fora de âmbito; a app não contorna nem implementa DRM |
| Catch-up/timeshift | Depende do servidor; pós-MVP |

### 6.4 Opções para servidores HTTP-only ou sem CORS

| Opção | Custo | Prós | Contras |
|---|---|---|---|
| A. Só "modo direto" (aceitar a limitação) | 0 | Simples, sem terceiros | Pode não funcionar com o fornecedor do utilizador |
| B. Proxy alojado em Cloudflare Workers | 0 (100k pedidos/dia) | Rápido de montar | Termos da Cloudflare restringem vídeo fora de Stream/R2; cada segmento conta como pedido; o proxy vê credenciais |
| C. Proxy self-hosted pelo utilizador (Node/Deno em PC/RPi/VPS) exposto por HTTPS (ex.: Tailscale Serve/Funnel, certificado próprio) | 0 em casa | Controlo total, sem terceiros | Requer configuração técnica |
| D. Shell nativo Android (Capacitor) com cleartext + HTTP nativo | 0 (sideload); 25 USD Play Store | Resolve CORS e mixed content no Android | iOS exige 99 USD/ano; deixa de ser "só browser" |

**Recomendação:** MVP com A + diagnóstico claro; contrato `UrlRewriter` preparado para C; D como alternativa arquitetural. **A decisão final depende do spike S-00 com o fornecedor real do utilizador** (ADR-010, pendente).

## 7. Xtream Codes API (pontos usados)

| Pedido | Uso |
|---|---|
| `player_api.php?username&password` | Autenticação; `user_info` (status, exp_date, max_connections, allowed_output_formats) e `server_info` (url, https_port, server_protocol) |
| `&action=get_live_categories` / `get_live_streams[&category_id]` | Live |
| `&action=get_vod_categories` / `get_vod_streams` / `get_vod_info&vod_id` | Filmes |
| `&action=get_series_categories` / `get_series` / `get_series_info&series_id` | Séries/temporadas/episódios |
| `&action=get_short_epg&stream_id&limit` | Agora/seguinte (títulos em base64) |
| `xmltv.php?username&password` | EPG completo (pode ter dezenas de MB) |
| URLs de stream | `{base}/live/{u}/{p}/{id}.{ts|m3u8}`, `{base}/movie/{u}/{p}/{id}.{ext}`, `{base}/series/{u}/{p}/{id}.{ext}` |

Notas: não é uma API normalizada — variações entre painéis (XUI.one, etc.), campos ausentes, números como strings. O cliente deve validar defensivamente (schemas tolerantes). `server_info.https_port` permite tentar HTTPS automaticamente.

## 8. M3U/M3U8
- `#EXTM3U [url-tvg|x-tvg-url="..."]`, `#EXTINF:-1 tvg-id tvg-name tvg-logo group-title tvg-chno catchup...,Nome`, `#EXTVLCOPT`, `#KODIPROP` (ignorados ou só lidos).
- Listas de 50k–200k linhas são comuns → parse em Web Worker, em streaming, com progresso.
- URLs `get.php?username=..&password=..&type=m3u_plus` indicam um servidor Xtream → sugerir conversão para fonte Xtream (melhor desempenho e metadados).

## 9. EPG
- XMLTV pode ser `.xml.gz`: `DecompressionStream('gzip')` é nativo nos browsers modernos.
- Parse em streaming (SAX) num worker; guardar só janela de −2h a +24/48h.
- Correspondência: `tvg-id` ↔ `channel@id`; fallback por nome normalizado (minúsculas, sem acentos, sem sufixos HD/FHD/"PT:"). Correspondência imperfeita é inevitável e deve ser documentada na UI.

## 10. Alojamento gratuito

| Plataforma | Deploy Git | HTTPS + domínio | Limites relevantes | Headers custom | SPA fallback | Riscos |
|---|---|---|---|---|---|---|
| **GitHub Pages** | Sim (Actions) | `*.github.io` | 1 GB site; 100 GB/mês soft; 10 builds/h (não se aplica a Actions) | Não (CSP só por `<meta>`) | Não (usar HashRouter ou `404.html`) | Repo tem de ser **público** no plano Free |
| Cloudflare Pages | Sim | `*.pages.dev` | 500 builds/mês; pedidos estáticos ilimitados | Sim (`_headers`) | Sim | Investimento migrado para Workers static assets; requer conta nova |
| Cloudflare Workers (static assets) | Sim | `*.workers.dev` | Estáticos não medidos | Sim | Sim | Conta nova; mais configuração |
| Netlify | Sim | `*.netlify.app` | Plano gratuito por créditos (mudou em 2025) | Sim | Sim | Alterações frequentes de plano |
| Vercel Hobby | Sim | `*.vercel.app` | Uso **não comercial** | Sim | Sim | Termos Hobby |

O tráfego de vídeo **nunca** passa pelo alojamento (a app só serve ~1–2 MB de ficheiros estáticos), pelo que os limites de largura de banda são irrelevantes na prática.

**Recomendação:** GitHub Pages (conta já existe, zero contas novas, Actions). Alternativa: Cloudflare Pages/Workers se forem necessários headers HTTP (CSP `frame-ancestors`, etc.) ou caso se adote o proxy da opção B.

### 10.1 Vercel e Supabase fazem sentido?

| Serviço | Para que serviria | Avaliação |
|---|---|---|
| **Vercel** (Hobby) | Alojar a SPA; Functions como proxy | Alojar a SPA funciona, mas não acrescenta nada ao GitHub Pages para uma app estática, e o plano Hobby é **só para uso não comercial**. Usar Functions/Edge como proxy de vídeo não serve: a largura de banda do plano gratuito é limitada, as funções têm limites de duração e as credenciais IPTV passariam pela infraestrutura de terceiros. **Não recomendado.** Seria uma alternativa aceitável ao Cloudflare Pages caso fossem precisos headers HTTP. |
| **Supabase** (Free) | Postgres/Auth/Storage para sincronizar entre dispositivos; Edge Functions como proxy | É um backend: contradiz o ADR-001 sem uma necessidade concreta no MVP. Guardar credenciais IPTV numa base de dados de terceiros piora a privacidade. Os projetos gratuitos ficam em pausa após inatividade, e as Edge Functions têm os mesmos problemas de proxy de vídeo. **Não recomendado no MVP.** Se a sincronização entre dispositivos vier a ser pedida, Supabase é o candidato a avaliar (com segredos cifrados no cliente por palavra-passe do utilizador, end-to-end), mas o EXP-01 (exportar/importar ficheiro) cobre a necessidade sem backend. |

## Fontes consultadas
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Cloudflare — delivering videos with Cloudflare](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/delivering-videos-with-cloudflare/index.md)
- [Cloudflare Pages vs Workers 2026 (morphllm)](https://www.morphllm.com/comparisons/cloudflare-pages-vs-workers), [Cloudflare free limits (eastondev)](https://eastondev.com/blog/en/posts/dev/20260526-cloudflare-free-limits/)
- [Chrome — Local Network Access](https://developer.chrome.com/blog/local-network-access)
- [Safari 17.1 Managed Media Source (Radiant)](https://payment.radiantmediaplayer.com/blog/at-last-safari-17.1-now-brings-the-new-managed-media-source-api-to-iphone.html), [Bitmovin — MMS](https://community.bitmovin.com/t/everything-you-need-to-know-about-apple-s-new-managed-media-source/2076)
- Registo npm (versões e licenças), inspeção dos pacotes `hls.js@1.7.3` e `mpegts.js@1.8.2`
