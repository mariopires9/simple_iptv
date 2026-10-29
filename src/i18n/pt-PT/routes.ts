import type { routes as base } from '../en/routes';
import type { MessageShape } from '../types';

export const routes = {
  screens: {
    home: {
      title: 'Início',
      empty: 'Continuar a ver, canais recentes e favoritos vão aparecer aqui.',
    },
    live: { title: 'TV em direto', empty: 'Os canais em direto vão aparecer aqui.' },
    movies: { title: 'Filmes', empty: 'Os filmes vão aparecer aqui.' },
    movieDetails: { title: 'Detalhes do filme', empty: 'Os detalhes do filme vão aparecer aqui.' },
    series: { title: 'Séries', empty: 'As séries vão aparecer aqui.' },
    seriesDetails: {
      title: 'Detalhes da série',
      empty: 'As temporadas e os episódios vão aparecer aqui.',
    },
    favorites: {
      title: 'Favoritos',
      empty: 'Os seus canais, filmes e séries favoritos vão aparecer aqui.',
    },
    search: { title: 'Pesquisar', empty: 'Pesquise canais, filmes e séries.' },
    settings: {
      title: 'Definições',
      empty: 'As definições vão aparecer aqui.',
      myLists: 'As minhas listas',
      myListsHint: 'Adicionar, alternar, atualizar ou remover as tuas listas IPTV',
      privacy: 'Privacidade e dados',
      privacyHint: 'O que fica guardado neste dispositivo',
    },
    sources: { title: 'As minhas listas', empty: 'As suas listas IPTV vão aparecer aqui.' },
  },
  categoryLabel: (id: string) => `Categoria: ${id}`,
  itemLabel: (id: string) => `Item: ${id}`,
  notFound: {
    title: 'Página não encontrada',
    message: 'A página que procura não existe.',
  },
  error: {
    message: 'Não foi possível mostrar este ecrã. Tente novamente ou volte ao Início.',
  },
  goHome: 'Ir para o Início',
} satisfies MessageShape<typeof base>;
