import type { state as base } from '../en/state';
import type { MessageShape } from '../types';

export const state = {
  loading: 'A carregar…',
  details: 'Detalhes',
  cancel: 'Cancelar',
  cancelling: 'A cancelar…',
  dismiss: 'Fechar',
  progress: {
    count: (count: string) => `${count} processados`,
    countOf: (count: string, total: string) => `${count} de ${total}`,
  },
  actions: {
    retry: 'Tentar novamente',
    reload: 'Recarregar',
    'edit-source': 'Editar lista',
    'reenter-credentials': 'Reintroduzir a palavra-passe',
  },
  errors: {
    cancelled: { title: 'Cancelado', message: 'A operação foi cancelada.' },
    net: {
      offline: {
        title: 'Está sem ligação',
        message: 'Sem ligação à rede. Verifique a ligação e tente novamente.',
      },
      timeout: {
        title: 'O servidor demorou demasiado',
        message: 'O servidor não respondeu a tempo. Tente novamente daqui a pouco.',
      },
      blocked: {
        title: 'Pedido bloqueado pelo browser',
        message:
          'O browser não permitiu o pedido a este servidor. Verifique o endereço ou tente novamente.',
      },
      blockedCors: {
        title: 'O servidor não permite apps web',
        message:
          'Este servidor não permite o acesso a partir de apps web (CORS). Descarregue a lista e importe o ficheiro, ou use outro endereço do servidor.',
      },
      blockedMixedContent: {
        title: 'Endereço do servidor inseguro',
        message:
          'Este servidor usa HTTP, que os browsers bloqueiam numa página segura (HTTPS). Use um endereço HTTPS se o servidor o disponibilizar.',
      },
      http: {
        title: 'Resposta inesperada do servidor',
        message: 'O servidor devolveu uma resposta inesperada. Tente novamente mais tarde.',
      },
      httpStatus: (status: string) =>
        `O servidor devolveu uma resposta inesperada (HTTP ${status}). Tente novamente mais tarde.`,
      auth: {
        title: 'Início de sessão rejeitado',
        message:
          'O servidor rejeitou o nome de utilizador ou a palavra-passe. Verifique-os e tente novamente.',
      },
      parse: {
        title: 'Não foi possível ler a resposta',
        message:
          'O servidor respondeu com algo que a app não compreende. Verifique o endereço e tente novamente.',
      },
    },
    worker: {
      failed: {
        title: 'O processamento falhou',
        message: 'Não foi possível processar os dados. Tente novamente.',
      },
    },
    db: { title: 'Armazenamento indisponível' },
    vault: {
      'missing-key': {
        title: 'Palavra-passe guardada indisponível',
        message:
          'A chave que protege a sua palavra-passe guardada desapareceu (os dados do browser podem ter sido limpos). Introduza a palavra-passe novamente.',
      },
      'decrypt-failed': {
        title: 'Palavra-passe guardada ilegível',
        message:
          'Não foi possível decifrar a sua palavra-passe guardada. Introduza a palavra-passe novamente.',
      },
    },
    unknown: {
      title: 'Algo correu mal',
      message: 'Ocorreu um erro inesperado. Tente novamente.',
    },
  },
} satisfies MessageShape<typeof base>;
