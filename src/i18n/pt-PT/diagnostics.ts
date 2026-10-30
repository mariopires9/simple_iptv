import type { diagnostics as base } from '../en/diagnostics';
import type { MessageShape } from '../types';

export const diagnostics = {
  title: 'Diagnóstico',
  back: 'As minhas listas',
  intro:
    'Verifica se esta lista pode funcionar neste browser e o que pode fazer se não funcionar. Faz um pedido à API do seu fornecedor e abre brevemente o primeiro canal em direto (apenas os primeiros bytes).',
  running: 'A verificar…',
  runAgain: 'Verificar novamente',
  copy: 'Copiar relatório',
  copied: 'Relatório copiado',
  formatSaveFailed: 'Não foi possível mudar o formato em direto. Tente novamente.',
  copyFailed:
    'Não foi possível copiar o relatório automaticamente. Selecione o texto abaixo e copie-o.',
  reportLabel: 'Relatório de diagnóstico',
  notFound: {
    title: 'Lista não encontrada',
    message: 'Esta lista já não existe. Pode ter sido removida.',
  },
  loadError: {
    title: 'Não foi possível carregar a lista',
    message: 'Não foi possível ler os seus dados guardados. Tente novamente.',
  },
  summary: {
    ok: 'Não foram encontrados problemas.',
    warning: 'Esta lista deve funcionar, com algumas limitações.',
    error: 'Foram encontrados problemas: veja abaixo o que pode fazer.',
    skipped: 'Não foi possível verificar nada.',
  },
  status: { ok: 'OK', warning: 'Aviso', error: 'Problema', skipped: 'Não verificado' },
  yes: 'sim',
  no: 'não',
  checks: {
    https: {
      title: 'HTTPS',
      reasons: {
        https: 'A lista usa um endereço seguro (HTTPS).',
        'http-blocked':
          'A lista usa HTTP. Esta app corre numa página segura (HTTPS) e os browsers bloqueiam pedidos HTTP a partir de páginas seguras (conteúdo misto).',
        'http-local':
          'A lista usa HTTP. Funciona nesta página local, mas os browsers bloqueiam-na na app publicada (HTTPS).',
        'not-applicable': 'Não é necessário: a lista é um ficheiro neste dispositivo.',
      },
      httpsAvailable: 'O servidor também responde por HTTPS.',
    },
    api: {
      title: 'Acesso à API (CORS)',
      reasons: {
        ok: 'O browser consegue ler as respostas do fornecedor.',
        'auth-rejected':
          'O servidor respondeu, por isso o browser consegue alcançá-lo, mas rejeitou o nome de utilizador ou a palavra-passe.',
        'mixed-content':
          'O browser bloqueou o pedido porque o servidor usa HTTP numa página segura (conteúdo misto).',
        cors: 'O browser bloqueou o pedido. O mais provável é o servidor não permitir o acesso a partir de aplicações web (CORS), ou o endereço estar errado ou inacessível.',
        timeout: 'O servidor não respondeu a tempo.',
        'network-error': 'O pedido não foi concluído.',
        'http-error': 'O servidor respondeu com um erro.',
        'invalid-response':
          'O servidor respondeu com algo que não é uma lista nem uma resposta de API válida.',
        offline: 'Não verificado: não há ligação à rede.',
        'no-secret':
          'Não verificado: não foi possível ler o acesso ou o endereço guardados. Edite a lista e introduza-os novamente.',
        'invalid-address':
          'Não verificado: o endereço do servidor guardado nesta lista não é válido. Edite a lista e corrija-o.',
        'not-applicable': 'Não é necessário: a lista é um ficheiro neste dispositivo.',
      },
      httpStatus: (status: string) => `Estado HTTP ${status}.`,
    },
    liveFormat: {
      title: 'Formato em direto (TS/HLS)',
      reasons: {
        ok: 'Os canais em direto podem ser reproduzidos neste browser no formato escolhido.',
        'format-not-allowed':
          'A sua conta não permite o formato em direto escolhido. Escolha outro para esta lista.',
        'format-unplayable':
          'Este browser não consegue reproduzir o formato em direto escolhido. Escolha outro para esta lista.',
        'none-playable':
          'Este browser não consegue reproduzir nenhum formato em direto desta lista.',
        'per-channel':
          'O endereço de cada canal define o seu formato; este browser reproduz MPEG-TS e HLS.',
        'per-channel-partial':
          'O endereço de cada canal define o seu formato; este browser só reproduz alguns deles.',
      },
      configured: (format: string) => `Formato escolhido: ${format}.`,
      allowed: (formats: string) => `Formatos permitidos pela conta: ${formats}.`,
      playable: (formats: string) => `Este browser reproduz: ${formats}.`,
      playableNone: 'Este browser reproduz: nenhum.',
      formats: { auto: 'Automático', ts: 'MPEG-TS', m3u8: 'HLS' },
      engines: { native: 'leitor nativo', hls: 'hls.js', mpegts: 'mpegts.js' },
    },
    liveStream: {
      title: 'Teste de stream em direto',
      reasons: {
        partial: 'Os canais em direto podem reproduzir num formato, mas não no outro.',
        'no-channels': 'Não verificado: esta lista não tem canais em direto (atualize-a primeiro).',
        offline: 'Não verificado: não há ligação à rede.',
        'no-secret':
          'Não verificado: não foi possível ler o login guardado. Edite a lista e introduza-o novamente.',
        unavailable:
          'Não verificado: o primeiro canal em direto não tem um endereço que esta app consiga abrir.',
      },
      fact: (format: string, engine: string, result: string, address: string) =>
        `${format} (${engine}): ${result} — ${address}`,
      notPlayable: 'não reproduzível aqui',
      results: {
        ok: 'responde, parece um stream',
        'insecure-url': 'endereço http:// (bloqueado numa app https)',
        'insecure-redirect': 'redireciona para http:// (bloqueado numa app https)',
        'insecure-segments': 'a playlist indica endereços http:// (bloqueados numa app https)',
        'redirect-blocked': 'redireciona para um endereço que o browser não conseguiu abrir',
        'no-cors': 'sem cabeçalhos CORS (os motores web não o conseguem ler)',
        'no-cors-native': 'sem cabeçalhos CORS (o leitor nativo não precisa deles)',
        unreachable: 'sem CORS ou inacessível (o browser não indica qual)',
        auth: 'acesso rejeitado',
        'http-error': 'erro HTTP',
        'not-media': 'não é um stream',
        timeout: 'sem resposta a tempo',
        'invalid-url': 'endereço inválido',
      },
      status: (status: string) => `HTTP ${status}`,
      redirected: 'redirecionado',
      hevc: 'vídeo HEVC',
    },
    browser: {
      title: 'Suporte do browser',
      reasons: {
        mse: 'Este browser suporta Media Source Extensions, que a app usa para a maioria das emissões.',
        mms: 'Este browser suporta Managed Media Source, que a app usa para a maioria das emissões.',
        'native-hls-only':
          'Este browser só reproduz HLS de forma nativa: os canais em direto MPEG-TS não funcionam aqui.',
        none: 'Este browser não tem forma de reproduzir emissões em direto (sem Media Source Extensions nem HLS nativo).',
      },
      facts: (mse: string, mms: string, nativeHls: string) =>
        `Media Source Extensions: ${mse} · Managed Media Source: ${mms} · HLS nativo: ${nativeHls}.`,
    },
    codecs: {
      title: 'Codecs',
      reasons: {
        all: 'Este browser indica suporte para todos os codecs testados.',
        'optional-missing':
          'Alguns codecs não são suportados: os canais que os usam podem ficar sem imagem ou sem som.',
        'required-missing':
          'Este browser não suporta H.264 ou AAC, usados por quase todas as emissões.',
      },
      names: {
        h264: 'H.264',
        hevc: 'HEVC (H.265)',
        aac: 'AAC',
        ac3: 'AC-3 (Dolby Digital)',
        eac3: 'E-AC-3 (Dolby Digital Plus)',
      },
      fact: (codec: string, supported: string) => `${codec}: ${supported}`,
      note: 'Suporte indicado pelo browser; a reprodução real também depende do dispositivo.',
    },
  },
  actionsTitle: 'O que pode fazer',
  actions: {
    'use-https':
      'Use um endereço HTTPS se o seu fornecedor o disponibilizar: edite a lista e mude o endereço para https://.',
    'local-file':
      'Transfira a lista (M3U) para este dispositivo e adicione-a como ficheiro. Isto evita o pedido da lista; o endereço de cada canal tem de continuar a funcionar no browser.',
    safari:
      'Experimente o Safari (Mac, iPhone ou iPad): reproduz HLS de forma nativa e suporta mais codecs, como áudio Dolby e HEVC.',
    'proxy-future':
      'Um proxy pessoal, gerido por si, poderia contornar estes limites. Esta app ainda não o suporta.',
    'check-network': 'Verifique a sua ligação à internet.',
    'check-credentials':
      'Verifique o nome de utilizador, a palavra-passe e o endereço do servidor da lista.',
    'contact-provider': 'Pergunte ao seu fornecedor se o serviço funciona em browsers.',
    'switch-live-format': 'Mude o formato em direto preferido desta lista.',
    'device-app':
      'Este fornecedor envia os streams por http://, que os browsers bloqueiam dentro de uma app segura (https): use uma app de leitor no seu dispositivo para esta lista, ou peça ao fornecedor streams https.',
    retry: 'Tente novamente daqui a pouco.',
  },
  links: {
    editList: 'Editar lista',
    addList: 'Adicionar lista',
    useFormat: (format: string) => `Usar ${format} nesta lista`,
  },
  report: {
    heading: 'Simple IPTV — diagnóstico de compatibilidade',
    date: 'Data',
    listType: 'Tipo de lista',
    address: 'Endereço (oculto)',
    page: 'Página da app',
    privacy: 'As credenciais e o endereço do servidor estão ocultos neste relatório.',
    actions: 'O que pode fazer',
  },
} satisfies MessageShape<typeof base>;
