import type { movies as base } from '../en/movies';
import type { MessageShape } from '../types';

export const movies = {
  title: 'Filmes',
  categories: 'Categorias',
  all: 'Todos',
  uncategorized: 'Sem categoria',
  gridLabel: (category: string) => `Filmes em ${category}`,
  keyboardHint: 'Setas para mover entre filmes, Enter para abrir o selecionado.',
  loadingCard: 'A carregar…',
  watched: (percent: string) => `${percent} visto`,
  sort: {
    label: 'Ordenar por',
    added: 'Adicionados recentemente',
    name: 'A–Z',
    rating: 'Classificação',
  },
  noSource: {
    title: 'Ainda não tem listas IPTV',
    message: 'Adicione uma lista para ver aqui os filmes.',
    add: 'Adicionar lista',
    manage: 'As minhas listas',
  },
  emptyCategory: { title: 'Esta categoria está vazia.', showAll: 'Mostrar todos os filmes' },
  categoryNotFound: {
    title: 'Categoria não encontrada',
    message:
      'Esta categoria não está na lista ativa. Pode ter sido removida por uma sincronização.',
  },
  loadError: {
    title: 'Não foi possível carregar os filmes',
    message: 'Tente novamente daqui a pouco.',
  },
  details: {
    back: 'Voltar aos filmes',
    play: 'Reproduzir',
    resumeAt: (time: string) => `Retomar aos ${time}`,
    addFavorite: 'Adicionar aos favoritos',
    removeFavorite: 'Remover dos favoritos',
    favoriteAdded: (name: string) => `${name} adicionado aos favoritos`,
    favoriteRemoved: (name: string) => `${name} removido dos favoritos`,
    favoriteFailed: (name: string) => `Não foi possível atualizar os favoritos de ${name}`,
    more: 'Mais',
    less: 'Menos',
    hoursMinutes: (hours: string, minutes: string) => `${hours} h ${minutes} min`,
    minutes: (minutes: string) => `${minutes} min`,
    rating: (rating: string) => `Classificação ${rating} em 10`,
    director: 'Realização',
    cast: 'Elenco',
    synopsis: 'Sinopse',
    infoFailed: 'Não foi possível carregar mais detalhes. A mostrar a informação da lista.',
    notFound: {
      title: 'Filme não encontrado',
      message: 'Este filme não está na lista ativa. Pode ter sido removido por uma sincronização.',
    },
    loadError: {
      title: 'Não foi possível carregar este filme',
      message: 'Tente novamente daqui a pouco.',
    },
  },
  player: {
    loading: (name: string) => `A carregar ${name}…`,
    unsupported: {
      title: 'Este filme usa DRM / DASH, que esta aplicação não suporta',
      message: 'Emissões protegidas (DRM) e DASH não podem ser reproduzidas nesta aplicação.',
    },
    credentials: {
      title: 'Introduza novamente a palavra-passe desta lista',
      message:
        'A palavra-passe guardada já não pode ser lida neste dispositivo. Introduza-a novamente em As minhas listas para ver esta lista.',
      action: 'As minhas listas',
    },
    unavailable: {
      title: 'Este filme não pode ser reproduzido',
      message:
        'A lista não tem um endereço de emissão válido para este filme. Tente sincronizar a lista.',
    },
    resolveError: {
      title: 'Não foi possível iniciar este filme',
      message: 'Tente novamente daqui a pouco.',
    },
  },
} satisfies MessageShape<typeof base>;
