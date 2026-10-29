import type { live as base } from '../en/live';
import type { MessageShape } from '../types';

export const live = {
  title: 'TV em direto',
  categories: 'Categorias',
  virtualCategories: { favorites: 'Favoritos', recent: 'Recentes', all: 'Todos' },
  uncategorized: 'Sem categoria',
  channelsIn: (category: string) => `Canais em ${category}`,
  favorite: 'Favorito',
  toggleFavorite: (name: string) => `Alternar favorito: ${name}`,
  favoriteAdded: (name: string) => `${name} adicionado aos favoritos`,
  favoriteRemoved: (name: string) => `${name} removido dos favoritos`,
  favoriteFailed: (name: string) => `Não foi possível atualizar os favoritos de ${name}`,
  loadingRow: 'A carregar…',
  keyboardHint: 'Setas para mover, Enter para reproduzir, F para adicionar ou remover favorito.',
  filter: {
    label: 'Filtrar canais',
    placeholder: 'Filtrar canais…',
    hint: 'Escreva parte de um nome ou um número de canal. Esc limpa o filtro.',
    clear: 'Limpar filtro',
    results: (count: number) =>
      count === 0
        ? 'Nenhum canal corresponde'
        : count === 1
          ? '1 canal corresponde'
          : `${count} canais correspondem`,
    failed: 'Não foi possível filtrar esta categoria. É mostrada a lista completa.',
    noMatches: (query: string) => `Nenhum canal corresponde a «${query}»`,
  },
  epg: {
    region: 'Guia de programação',
    now: 'Agora',
    next: 'A seguir',
    times: (start: string, end: string) => `${start}–${end}`,
    progress: (title: string) => `Progresso de ${title}`,
    rowNow: 'Agora:',
  },
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
    region: (name: string) => `Leitor: ${name}`,
    watching: (name: string) => `A ver ${name}`,
    loading: (name: string) => `A carregar ${name}…`,
    channels: 'Canais',
    closeChannels: 'Fechar a lista de canais',
    unsupported: {
      title: 'Este canal usa DRM / DASH, que esta aplicação não suporta',
      message: 'Emissões protegidas (DRM) e DASH não podem ser reproduzidas nesta aplicação.',
    },
    credentials: {
      title: 'Volte a introduzir a palavra-passe desta lista',
      message:
        'A palavra-passe guardada já não pode ser lida neste dispositivo. Introduza-a novamente em As minhas listas para ver esta lista.',
      action: 'As minhas listas',
    },
    unavailable: {
      title: 'Não é possível reproduzir este canal',
      message:
        'A lista não tem um endereço de emissão válido para este canal. Experimente sincronizar a lista.',
    },
    resolveError: {
      title: 'Não foi possível iniciar este canal',
      message: 'Tente novamente dentro de momentos.',
    },
  },
} satisfies MessageShape<typeof base>;
