import type { player as base } from '../en/player';
import type { MessageShape } from '../types';

export const player = {
  locale: 'pt-PT',
  region: (title: string) => `Leitor: ${title}`,
  live: 'Em direto',
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
    blocked: {
      title: 'Emissão bloqueada pelo browser',
      message:
        'O browser não permitiu carregar esta emissão. Tente novamente ou verifique a origem.',
    },
    blockedMixedContent: {
      title: 'Endereço da emissão inseguro',
      message:
        'Esta emissão usa HTTP, que os browsers bloqueiam numa página segura (HTTPS). Use uma origem HTTPS se o fornecedor a disponibilizar.',
    },
    'unsupported-container': {
      title: 'Formato não suportado',
      message: 'Este browser não consegue reproduzir o formato desta emissão.',
    },
    'unsupported-codec': {
      title: 'Codec não suportado',
      message: 'Este browser não consegue descodificar o vídeo ou o áudio desta emissão.',
    },
    decode: {
      title: 'A reprodução falhou',
      message: 'Não foi possível descodificar a emissão. Tente novamente.',
    },
    auth: {
      title: 'Acesso rejeitado',
      message: 'O fornecedor rejeitou o acesso a esta emissão. Verifique a sua conta.',
    },
    unknown: {
      title: 'A reprodução falhou',
      message: 'Algo correu mal ao reproduzir esta emissão. Tente novamente.',
    },
  },
} satisfies MessageShape<typeof base>;
