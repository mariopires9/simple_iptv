import type { nav as base } from '../en/nav';
import type { MessageShape } from '../types';

export const nav = {
  mainNavigation: 'Navegação principal',
  home: 'Início',
  live: 'Direto',
  movies: 'Filmes',
  series: 'Séries',
  favorites: 'Favoritos',
  settings: 'Definições',
  search: 'Pesquisar',
  moreOptions: 'Mais opções',
  theme: 'Tema',
  themes: {
    system: 'Sistema',
    dark: 'Escuro',
    light: 'Claro',
  },
} satisfies MessageShape<typeof base>;
