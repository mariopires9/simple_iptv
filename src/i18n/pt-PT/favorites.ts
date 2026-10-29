import type { favorites as base } from '../en/favorites';
import type { MessageShape } from '../types';

export const favorites = {
  sections: {
    continueWatching: 'Continuar a ver',
    recentChannels: 'Canais recentes',
    favorites: 'Favoritos',
  },
  seeAllLabel: (section: string) => `Ver tudo: ${section}`,
  seeAll: 'Ver tudo',
  rowHint: 'Use as setas para a esquerda e para a direita para mover entre itens.',
  watched: (percent: string) => `${percent} visto`,
  episode: (season: number, episode: number) => `T${season} · E${episode}`,
  empty: {
    title: 'Ainda não há nada para mostrar',
    message: 'O que vê e os canais, filmes e séries que marcar como favoritos vão aparecer aqui.',
    live: 'Ver TV em direto',
    movies: 'Explorar filmes',
    series: 'Explorar séries',
  },
  loadError: {
    title: 'Não foi possível carregar o seu conteúdo',
    message: 'Ocorreu um erro ao ler os dados guardados neste dispositivo.',
  },
  clearHistory: {
    button: 'Limpar histórico',
    title: 'Limpar o histórico?',
    message:
      'Os canais recentes e "Continuar a ver" da lista ativa vão ser removidos. Os favoritos mantêm-se.',
    confirm: 'Limpar histórico',
    done: 'Histórico limpo.',
    failed: 'Não foi possível limpar o histórico. Tente novamente.',
  },
  screen: {
    tabsLabel: 'Tipos de favoritos',
    tabs: { live: 'Canais', movie: 'Filmes', series: 'Séries' },
    empty: {
      live: 'Ainda não tem canais favoritos.',
      movie: 'Ainda não tem filmes favoritos.',
      series: 'Ainda não tem séries favoritas.',
    },
    emptyHint: 'Marque um item com ★ para o encontrar aqui.',
    browse: { live: 'Ver TV em direto', movie: 'Ver filmes', series: 'Ver séries' },
    unavailable: 'Indisponível',
    unavailableHint: 'Já não está nesta lista',
    remove: 'Remover',
    removeLabel: (name: string) => `Remover ${name} dos favoritos`,
    removeUnavailableLabel: 'Remover item indisponível dos favoritos',
    removed: (name: string) => `${name} removido dos favoritos`,
    removedUnavailable: 'Item indisponível removido dos favoritos',
    removeFailed: 'Não foi possível atualizar os favoritos. Tente novamente.',
  },
} satisfies MessageShape<typeof base>;
