import type { player as base } from '../en/player';
import type { MessageShape } from '../types';

export const player = {
  locale: 'pt-PT',
  region: (title: string) => `Leitor: ${title}`,
  live: 'Em direto',
  dismiss: 'Fechar',
  controls: {
    play: 'Reproduzir',
    pause: 'Pausar',
    mute: 'Silenciar',
    unmute: 'Ativar som',
    volume: 'Volume',
    seek: 'Procurar',
    back10: 'Recuar 10 segundos',
    forward10: 'Avançar 10 segundos',
    previousChannel: 'Canal anterior',
    nextChannel: 'Canal seguinte',
    channelList: 'Lista de canais',
    fullscreen: 'Ecrã inteiro',
    exitFullscreen: 'Sair do ecrã inteiro',
    pictureInPicture: 'Imagem na imagem',
    exitPictureInPicture: 'Sair da imagem na imagem',
    close: 'Fechar leitor',
    goLive: 'Ir para o direto',
  },
  timeOf: (current: string, total: string) => `${current} de ${total}`,
  announce: {
    playing: 'A reproduzir',
    paused: 'Em pausa',
    muted: 'Som desativado',
    unmuted: 'Som ativado',
    buffering: 'A carregar…',
    mutedAutoplay: 'A reproduzir sem som. Use Ativar som para ligar o som.',
  },
  errors: {
    network: {
      title: 'Problema de ligação',
      message: 'Não foi possível carregar a emissão devido a um erro de rede. Tente novamente.',
    },
    networkLive: {
      title: 'Ligação perdida',
      message:
        'Não foi possível restabelecer a ligação ao canal após várias tentativas. Verifique a sua ligação e tente novamente, ou mude de canal.',
    },
    offline: {
      title: 'Sem ligação',
      message:
        'A reprodução precisa de ligação à internet. Verifique a sua ligação e tente novamente.',
    },
    blocked: {
      title: 'Emissão bloqueada pelo browser',
      message:
        'O browser bloqueou esta emissão. Provavelmente o servidor não permite o acesso a partir de aplicações web (CORS) ou não usa HTTPS. O diagnóstico de ligação explica o que pode fazer.',
    },
    blockedMixedContent: {
      title: 'Endereço da emissão inseguro',
      message:
        'Esta emissão usa HTTP, que os browsers bloqueiam numa página segura (HTTPS). Use uma origem HTTPS se o fornecedor a disponibilizar; o diagnóstico de ligação explica outras opções.',
    },
    'unsupported-container': {
      title: 'Formato ou codec não suportado',
      message:
        'Este browser não consegue reproduzir o formato ou o codec desta emissão, ou a emissão não está disponível.',
    },
    'unsupported-codec': {
      title: 'Formato ou codec não suportado',
      message: 'Este browser não consegue descodificar o vídeo ou o áudio desta emissão.',
    },
    codecNamed: (codec: string) => `Este browser não suporta o codec desta emissão: ${codec}.`,
    containerNamed: (container: string) =>
      `Este browser não consegue reproduzir emissões ${container}.`,
    noMse:
      'Este browser não consegue reproduzir este tipo de emissão (as Media Source Extensions não estão disponíveis).',
    decode: {
      title: 'A reprodução falhou',
      message: 'Não foi possível descodificar a emissão. Tente novamente.',
    },
    auth: {
      title: 'Acesso rejeitado',
      message:
        'O fornecedor rejeitou o acesso a esta emissão. A sua conta pode ter expirado ou estar inativa, ou pode ter atingido o número máximo de ligações simultâneas: feche outros leitores que a usem e tente novamente.',
    },
    restricted: {
      title: 'Reprodução restringida pelo fornecedor',
      message:
        'O fornecedor restringe a reprodução à sua própria aplicação/site: exige cabeçalhos (como Referer ou User-Agent) que os browsers não conseguem enviar.',
    },
    drm: {
      title: 'Este canal usa DRM / DASH, que esta aplicação não suporta',
      message: 'As emissões protegidas (DRM) e DASH não podem ser reproduzidas nesta aplicação.',
    },
    unknown: {
      title: 'A reprodução falhou',
      message: 'Algo correu mal ao reproduzir esta emissão. Tente novamente.',
    },
    actions: {
      diagnostics: 'Diagnóstico de ligação',
    },
  },
  reconnecting: (attempt: number, max: number) =>
    `A restabelecer a ligação… (tentativa ${attempt} de ${max})`,
  noAudio: {
    codec: (codec: string) => `Sem som: o áudio ${codec} não é suportado neste browser.`,
    unknown: 'Sem som: este browser pode não suportar o áudio desta emissão.',
  },
  noVideo: {
    codec: (codec: string) =>
      `Sem imagem: o codec de vídeo ${codec} não é suportado neste browser.`,
    unknown: 'Sem imagem: o codec de vídeo desta emissão não é suportado neste browser.',
  },
  tapForFullscreen: 'Toque para ecrã inteiro',
  nativeFullscreenNote:
    'Neste dispositivo, o ecrã inteiro usa o leitor do sistema e os respetivos controlos.',
  resumeUnsupported: 'A começar do início',
  attempts: {
    heading: 'Tentativas:',
    line: (position: number, format: string, engine: string, error: string) =>
      `${position}. ${format} via ${engine}: ${error}`,
    skipped: 'não reproduzível neste browser (ignorado)',
    engines: { native: 'leitor nativo', hls: 'hls.js', mpegts: 'mpegts.js' },
    mediaSources: { mse: 'Media Source Extensions', mms: 'ManagedMediaSource' },
    withMediaSource: (engine: string, api: string) => `${engine} (${api})`,
    probe: (finding: string, facts: string) =>
      `   Verificação: ${finding}${facts !== '' ? ` (${facts})` : ''}`,
    redirected: 'redirecionado',
    hevc: 'HEVC',
    status: (status: number) => `HTTP ${status}`,
    copy: 'Copiar detalhes',
    copied: 'Detalhes copiados',
    copyFailed: 'Não foi possível copiar os detalhes. Abra "Detalhes" e copie o texto.',
  },
  probe: {
    checking: 'A verificar a causa…',
    title: 'Causa provável',
    causes: {
      ok: 'O endereço responde e parece um stream válido: o problema é o formato ou o codec deste stream neste browser, não a ligação.',
      'insecure-url':
        'O endereço do stream usa http://, que o browser bloqueia dentro de uma app segura (https). Este fornecedor precisa de uma app de leitor no seu dispositivo: os browsers em https não reproduzem streams http.',
      'insecure-redirect':
        'O servidor redireciona o stream para um endereço http:// inseguro, que o browser bloqueia dentro de uma app https. Este fornecedor precisa de uma app de leitor no seu dispositivo: os browsers em https não reproduzem streams http.',
      'insecure-segments':
        'A playlist aponta para endereços http:// inseguros, que o browser bloqueia dentro de uma app https. Este fornecedor precisa de uma app de leitor no seu dispositivo: os browsers em https não reproduzem streams http.',
      'redirect-blocked':
        'O servidor redireciona o stream para outro endereço que o browser não conseguiu abrir — normalmente um endereço http:// inseguro, que os browsers bloqueiam dentro de uma app https. Se for o caso, este fornecedor precisa de uma app de leitor no seu dispositivo.',
      'no-cors':
        'O servidor não permite que apps web leiam o stream (sem cabeçalhos CORS), por isso este formato não reproduz no browser. Experimente o outro formato de direto nesta lista (o HLS reproduz de forma nativa no Safari).',
      'no-cors-native':
        'O servidor não permite que apps web leiam a playlist (sem cabeçalhos CORS). O leitor nativo não precisa disso, por isso não é essa a causa, e o browser não indica porque recusou o stream.',
      unreachable:
        'O browser não conseguiu abrir o endereço do stream: o servidor não envia cabeçalhos CORS, está inacessível ou o pedido foi bloqueado — o browser não indica qual.',
      auth: 'O fornecedor rejeitou o pedido (HTTP 401/403): a conta pode ter expirado ou atingido o limite de ligações simultâneas.',
      'http-error': 'O servidor respondeu ao pedido do stream com um erro.',
      'not-media':
        'O servidor respondeu com algo que não é um stream (por exemplo, uma página de erro).',
      timeout: 'A verificação demorou demasiado: não foi possível determinar a causa.',
      'invalid-url': 'O endereço do stream não é válido.',
    },
    hevc: 'O stream usa vídeo HEVC (H.265), que este browser pode não conseguir reproduzir neste formato.',
  },
} satisfies MessageShape<typeof base>;
