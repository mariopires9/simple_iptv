import type { live as base } from '../en/live';
import type { MessageShape } from '../types';

export const live = {
  title: 'TV em direto',
  categories: 'Categorias',
  virtualCategories: { favorites: 'Favoritos', recent: 'Recentes', all: 'Todos' },
  channelsIn: (category: string) => `Canais em ${category}`,
  favorite: 'Favorito',
  toggleFavorite: (name: string) => `Alternar favorito: ${name}`,
  favoriteAdded: (name: string) => `${name} adicionado aos favoritos`,
  favoriteRemoved: (name: string) => `${name} removido dos favoritos`,
  favoriteFailed: (name: string) => `Não foi possível atualizar os favoritos de ${name}`,
  loadingRow: 'A carregar…',
  keyboardHint: 'Setas para mover, Enter para reproduzir, F para adicionar ou remover favorito.',
  noSource: {
    title: 'Ainda não tem listas IPTV',
    message: 'Adicione uma lista para ver aqui os canais em direto.',
    add: 'Adicionar lista',
    manage: 'As minhas listas',
  },
  emptyCategory: { title: 'Esta categoria está vazia.', showAll: 'Mostrar todos os canais' },
  emptyFavorites: {
    title: 'Ainda não tem canais favoritos',
    message: 'Selecione um canal e prima F ou a estrela para o adicionar aqui.',
  },
  emptyRecent: {
    title: 'Ainda não há canais recentes',
    message: 'Os canais que vir aparecem aqui.',
  },
  categoryNotFound: {
    title: 'Categoria não encontrada',
    message: 'Esta categoria não existe na lista ativa. Pode ter sido removida numa sincronização.',
  },
  loadError: {
    title: 'Não foi possível carregar os canais',
    message: 'Tente novamente dentro de momentos.',
  },
  player: {
    idle: 'Selecione um canal para o ver aqui.',
  },
} satisfies MessageShape<typeof base>;
