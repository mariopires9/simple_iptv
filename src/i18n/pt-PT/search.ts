import type { search as base } from '../en/search';
import type { MessageShape } from '../types';

export const search = {
  title: 'Pesquisa',
  fieldLabel: 'Pesquisar canais, filmes e séries',
  placeholder: 'Canal, filme ou série',
  hint: 'Escreva pelo menos 2 caracteres para pesquisar na lista ativa.',
  groups: {
    live: 'TV em direto',
    movie: 'Filmes',
    series: 'Séries',
  },
  groupHeading: (name: string, total: number) => `${name} (${total})`,
  seeAll: (name: string, total: number) => `Ver todos os ${total} em ${name}`,
  allResults: 'Todos os resultados',
  showingFirst: (shown: number, total: number) => `A mostrar os primeiros ${shown} de ${total}.`,
  announce: (total: number) =>
    total === 0 ? 'Sem resultados' : total === 1 ? '1 resultado' : `${total} resultados`,
  channelNumber: (n: number) => `N.º ${n}`,
  noResults: {
    title: 'Sem resultados',
    message: (query: string) => `Nada na lista ativa corresponde a “${query}”.`,
  },
  noList: {
    title: 'Sem lista',
    message: 'Adicione uma lista para pesquisar os seus canais, filmes e séries.',
    action: 'Adicionar lista',
  },
  error: {
    title: 'A pesquisa não está disponível',
    message: 'Não foi possível pesquisar. Tente novamente.',
  },
  recent: {
    title: 'Pesquisas recentes',
    clear: 'Limpar',
    clearLabel: 'Limpar pesquisas recentes',
    empty: 'As suas pesquisas recentes aparecem aqui.',
  },
} satisfies MessageShape<typeof base>;
