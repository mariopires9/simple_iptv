# Especificação de produto

## 1. Resumo
**Simple IPTV** (nome provisório) é um leitor IPTV gratuito, sem anúncios e sem telemetria, que corre no browser e se instala como PWA em Android, iOS e desktop. O utilizador liga as **suas próprias** fontes (Xtream Codes ou listas M3U) e vê TV em direto, filmes e séries com uma interface moderna, rápida e mobile-first.

A app é um **leitor genérico**: não inclui, sugere nem distribui listas, canais ou conteúdos.

## 2. Utilizadores-alvo
| Persona | Necessidade | Implicação |
|---|---|---|
| Utilizador comum com subscrição IPTV | "Colar os dados que o fornecedor me deu e ver TV" | Onboarding de 1 ecrã, mensagens de erro em linguagem simples |
| Utilizador técnico | Várias listas, M3U locais, EPG externo | Gestão de fontes, diagnóstico detalhado |
| Utilizador em desktop/TV com teclado | Zapping rápido | Atalhos de teclado, foco visível |

## 3. Âmbito

### 3.1 MVP (obrigatório) — v1.0
| Área | Incluído |
|---|---|
| Fontes | Adicionar Xtream (servidor, utilizador, palavra-passe) com teste de ligação; importar M3U por URL e por ficheiro local; página **"As minhas listas"** com todas as listas guardadas no dispositivo (sem limite de número), onde se editam, atualizam, removem e escolhe a lista ativa; diagnóstico de erros (credenciais, conta expirada, HTTPS, CORS, timeout); credenciais cifradas; apagar todos os dados |
| TV em direto | Categorias; lista virtualizada com logos; filtro rápido; favoritos; recentes; leitor com zapping (anterior/seguinte, lista sobreposta); ecrã inteiro; lembrar último canal e estado de navegação; agora/seguinte (Xtream) |
| Filmes | Grelha por categoria com posters; detalhe (sinopse, ano, duração, rating quando existirem); reprodução; retomar |
| Séries | Grelha por categoria; detalhe com temporadas e episódios; reprodução; retomar; próximo episódio |
| Pesquisa | Pesquisa global na fonte ativa (canais, filmes, séries) |
| Favoritos/Histórico | Favoritos de canais, filmes e séries; "continuar a ver"; canais recentes |
| UX | Tema escuro (padrão) e claro; mobile/tablet/desktop; estados loading/erro/vazio/offline; navegação por teclado; acessibilidade WCAG 2.2 AA nos fluxos principais |
| PWA | Instalação; app shell offline; prompt de atualização; mensagem clara sem ligação |
| Leitor | Seleção automática de engine; mensagens de erro acionáveis; PiP quando suportado |

### 3.2 Versão posterior (v1.1–v1.2)
| Funcionalidade | Razão para adiar |
|---|---|
| EPG XMLTV (url-tvg / URL manual) + correspondência de canais | Ficheiros grandes, parse e matching complexos; Xtream short EPG cobre o essencial |
| Faixas de áudio e legendas | hls.js expõe facilmente; nativo/mpegts variam — precisa de testes por dispositivo |
| Palavra-passe mestra (bloqueio da app) | Melhora segurança, mas acrescenta fricção; opcional |
| Exportar/importar configurações (ficheiro, segredos cifrados com palavra-passe) | Substitui sincronização entre dispositivos sem backend |
| Navegação D-pad/comando de TV | Necessita de gestão de foco espacial |
| Media Session (controlos no ecrã de bloqueio) | Baixo custo, mas valor depende de reprodução em segundo plano |

### 3.3 Opcional / experimental
| Funcionalidade | Nota |
|---|---|
| Proxy self-hosted de referência (PRX-01) | Pode passar a obrigatório conforme ADR-010 |
| Shell Android Capacitor (NAT-01) | Contorna CORS/mixed content no Android |
| Controlo parental com PIN | Só dissuasor em client-side; não é segurança real |
| Perfis múltiplos | Favoritos/histórico por perfil |
| EPG em grelha | Custo alto de UI e desempenho |
| Catch-up/timeshift | Depende do servidor |
| Chromecast/AirPlay/Remote Playback | AirPlay "grátis" no Safari com engine nativa; Cast exige SDK e streams acessíveis pelo recetor |
| Sincronização entre dispositivos | Exigiria backend ou armazenamento de terceiros; fora de âmbito |

### 3.4 Fora de âmbito (explicitamente)
Listas pré-carregadas, diretórios de canais, DRM ou contorno de DRM, gravação/download de streams, transcodificação, contas de utilizador na nossa infraestrutura, publicidade, analytics.

## 4. Requisitos não funcionais
| ID | Requisito | Meta (medida em QA-03 / TEST_PLAN) |
|---|---|---|
| NFR-01 | Arranque (visita repetida, SW ativo, Android médio) | Ecrã útil < 1,0 s |
| NFR-02 | Primeiro carregamento (Lighthouse mobile) | LCP < 2,5 s; JS inicial ≤ 200 KB gz |
| NFR-03 | Scroll de listas com 20 000 canais | Sem *long tasks* > 50 ms; ≥ 55 fps |
| NFR-04 | Pesquisa sobre 100 000 itens | Resultados < 100 ms após índice construído |
| NFR-05 | Parse M3U de 50 000 entradas | < 5 s num Android médio, UI responsiva |
| NFR-06 | Zapping (HLS/TS, rede boa, servidor responsivo) | Primeiro frame < 3 s em p75 — **dependente do servidor; medido, não garantido** |
| NFR-07 | Acessibilidade | 0 violações axe "serious/critical"; Lighthouse a11y ≥ 95 |
| NFR-08 | Privacidade | 0 pedidos de rede para domínios que não sejam a origem da app ou os servidores configurados pelo utilizador |
| NFR-09 | Compatibilidade alvo | Chrome/Edge últimos 2, Firefox últimos 2, Safari ≥ 17.1 (iOS/macOS), Samsung Internet atual |

## 5. Limitações conhecidas a comunicar ao utilizador
1. Servidores **apenas HTTP** ou **sem CORS** podem não funcionar no browser (ver diagnóstico na app).
2. Áudio Dolby (AC-3/E-AC-3) e MP2 podem não ter som no Chrome/Firefox.
3. MKV/AVI dependem do browser.
4. No iPhone o ecrã inteiro usa os controlos nativos do iOS.
5. Reprodução em segundo plano não é garantida.
6. A app não funciona offline para ver conteúdo (só a interface abre).
7. Credenciais ficam no dispositivo; quem tem acesso ao dispositivo desbloqueado pode aceder-lhes.

## 6. Pressupostos
- P1: O utilizador tem pelo menos uma fonte IPTV legítima para testes (necessária para S-00).
- P2: Nome provisório "Simple IPTV" (derivado do nome do diretório) até decisão do utilizador.
- P3: Repositório público no GitHub é aceitável (requisito do GitHub Pages gratuito).
- P4: UI apenas em pt-PT no MVP.
- P5: Utilizador único por dispositivo no MVP.
- P6: As listas ficam só no dispositivo onde foram adicionadas; sem sincronização (ADR-014, decisão do utilizador).
