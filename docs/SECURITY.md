# Segurança, privacidade e limites legais

## 1. Modelo de ameaças (resumo)
| Ativo | Ameaça | Mitigação | Risco residual |
|---|---|---|---|
| Credenciais Xtream / URLs M3U | Leitura dos dados da app (backup, cópia de perfil, ferramenta forense casual) | AES-GCM com chave não exportável (ADR-006) | Quem usa o dispositivo desbloqueado na mesma origem consegue usar as credenciais |
| Credenciais | XSS via metadados/listas maliciosas | Renderização só como texto, CSP sem `unsafe-eval`/scripts externos, lint contra `dangerouslySetInnerHTML`, validação de URLs | Vulnerabilidade numa dependência |
| Credenciais | Exposição em logs/erros/relatórios | Redação central (FND-06), testes de propriedade | — |
| Credenciais | Visíveis nos URLs dos streams (protocolo Xtream) | Inerente ao protocolo; documentado | Visíveis em DevTools e para o servidor IPTV/proxy |
| Credenciais | Fuga de `Referer` para terceiros | `no-referrer` | — |
| Privacidade | Telemetria/rastreamento | Nenhum analytics; fontes auto-alojadas; teste E2E de allowlist de domínios | — |
| Integridade | Dependência comprometida (supply chain) | Lockfile, `npm ci`, Dependabot, audit, Actions fixadas por SHA, poucas dependências | Não eliminável |
| Disponibilidade | Lista enorme/maliciosa (DoS local) | Parsing em worker, limites (tamanho de linha 64 KB, nº de entradas configurável, aviso > 50 MB) | — |

## 2. Armazenamento de credenciais — o que dizemos ao utilizador (texto para UX-04)
> "As tuas credenciais ficam apenas neste dispositivo, cifradas. Isto impede leituras casuais dos dados da app, mas **não** protege contra quem tenha acesso ao teu dispositivo desbloqueado. As credenciais também fazem parte dos endereços dos canais, que são enviados ao teu fornecedor. Podes apagar tudo em Definições › Privacidade."

Limitações documentadas:
- Os URLs de streams de listas M3U ficam guardados **sem cifra** (custo de cifrar dezenas de milhares de URLs). Se a lista for de um servidor Xtream (`get.php`), a app propõe convertê-la numa fonte Xtream, onde só a palavra-passe é guardada (cifrada).
- Uma aplicação client-side **não consegue** esconder credenciais do próprio utilizador nem do browser.

## 3. Importação de listas e URLs
- Esquemas aceites: `http:` e `https:` apenas. Rejeitados: `javascript:`, `data:`, `file:`, `blob:` externos, `ftp:`, etc.
- URLs com `user:pass@host` são aceites para reprodução, mas nunca mostrados por inteiro na UI.
- Nomes, grupos, sinopses: texto puro; comprimento máximo truncado (ex.: 512 chars nome, 8 KB sinopse).
- Imagens externas: `<img>` com `referrerpolicy="no-referrer"`, sem `crossorigin` (evita CORS); falhas → fallback.
- Ficheiros importados (M3U, export JSON): tratados como não confiáveis, validados por schema.

## 4. SSRF e proxy (só se PRX-01 avançar)
O MVP não tem backend → não há SSRF do nosso lado. O proxy de referência, se criado, terá de: exigir token; aplicar allowlist de hosts definida pelo dono; bloquear IPs privados/loopback/link-local e metadados de cloud (169.254.169.254) **após** resolução DNS; limitar métodos a GET/HEAD; não registar URLs nem query strings; limitar taxa. Documentação a avisar contra expor o proxy publicamente sem token.

## 5. Dependências e licenças
- Allowlist de licenças no CI (FND-02). Todas as dependências previstas são MIT/Apache-2.0/ISC/OFL.
- Codecs: a app **não distribui codecs**; usa os do browser/SO. Não há encargos de licenciamento de H.264/HEVC/AAC/AC-3 para a app (são responsabilidade do browser/SO).
- hls.js e mpegts.js: Apache-2.0 → incluir aviso de licença em "Sobre › Licenças".

## 6. Permissões da PWA
Nenhuma permissão sensível pedida. Usadas apenas: armazenamento persistente (`storage.persist`), ecrã inteiro, PiP, orientação (opcional). **Não** pedidas: notificações, localização, câmara, microfone, rede local (exceto, no futuro, se o utilizador configurar um proxy na LAN — Chrome LNA).

## 7. Eliminação de dados
- "Apagar todos os dados" (SRC-10): IndexedDB (inclui chave do vault), Cache Storage de dados, `localStorage`/`sessionStorage` se usados. O utilizador pode ainda desinstalar a PWA ou limpar dados do site no browser.
- Remover fonte apaga em cascata os dados dessa fonte.

## 8. Limites legais e posicionamento
- A app é um **leitor genérico** (como VLC ou um browser): não fornece, aloja, indexa nem sugere conteúdos ou listas.
- Não inclui listas de terceiros, nem diretórios, nem pesquisa de listas públicas.
- Não implementa nem contorna DRM, autenticação ou restrições geográficas.
- Não grava nem descarrega streams.
- Aviso no onboarding e em "Sobre": "Usa apenas fontes e conteúdos que tens autorização para aceder."
- Distinção: o **alojamento da app** (gratuito, GitHub Pages) é independente dos **serviços IPTV** do utilizador, que têm os seus próprios custos, termos e limitações (ex.: número máximo de ligações).
- Nome e identidade visual próprios; não usar marcas, ícones ou capturas de outras apps (inclui "Smarters").

## 9. Checklist de segurança por story sensível
Stories que tocam `core/crypto`, `core/net`, `core/log`, `providers/*`, parsers, CSP ou SW exigem `/security-review` além de `/code-review`, e testes de regressão para cada achado corrigido.
