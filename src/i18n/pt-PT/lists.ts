import type { lists as base } from '../en/lists';
import type { MessageShape } from '../types';

export const lists = {
  selector: {
    label: (name: string) => `Lista ativa: ${name}`,
    none: 'Sem lista',
    noneLabel: 'Listas: ainda sem lista',
    manage: 'Gerir listas…',
    add: 'Adicionar lista',
  },
  switchFailed: 'Não foi possível mudar a lista ativa.',
  chooser: {
    title: 'Adicionar lista',
    xtream: {
      title: 'Xtream Codes',
      subtitle: 'Servidor, utilizador e palavra-passe (recomendado)',
    },
    m3uUrl: { title: 'Lista M3U (URL)', subtitle: 'O endereço de uma lista M3U' },
    m3uFile: {
      title: 'Ficheiro M3U local',
      subtitle: 'Um ficheiro de lista guardado neste dispositivo',
    },
  },
} satisfies MessageShape<typeof base>;
