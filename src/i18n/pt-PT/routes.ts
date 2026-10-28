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
    settings: { title: 'Definições', empty: 'As definições vão aparecer aqui.' },
    sources: { title: 'As minhas listas', empty: 'As suas listas IPTV vão aparecer aqui.' },
    onboarding: { title: 'Bem-vindo', empty: 'Adicione a sua primeira lista IPTV para começar.' },
  },
  categoryLabel: (id: string) => `Categoria: ${id}`,
  itemLabel: (id: string) => `Item: ${id}`,
  notFound: {
    title: 'Página não encontrada',
    message: 'A página que procura não existe.',
  },
  error: {
    title: 'Algo correu mal',
    message: 'Não foi possível mostrar este ecrã. Tente novamente ou volte ao Início.',
    retry: 'Tentar novamente',
  },
  goHome: 'Ir para o Início',
  dbUnavailable: {
    title: 'Armazenamento indisponível',
    reload: 'Recarregar',
  },
} satisfies MessageShape<typeof base>;
