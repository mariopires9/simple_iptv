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
        'O browser bloqueou esta emissão. Provavelmente o servidor não permite o acesso a partir de aplicações web (CORS) ou não usa HTTPS. Pode encaminhar esta lista pelo seu proxy pessoal (Definições › Proxy pessoal); o diagnóstico de ligação explica outras opções.',
    },
    blockedMixedContent: {
      title: 'Endereço da emissão inseguro',
      message:
        'Esta emissão usa HTTP, que os browsers bloqueiam numa página segura (HTTPS). Use uma origem HTTPS se o fornecedor a disponibilizar, ou encaminhe esta lista pelo seu proxy pessoal (Definições › Proxy pessoal); o diagnóstico de ligação explica outras opções.',
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
} satisfies MessageShape<typeof base>;
