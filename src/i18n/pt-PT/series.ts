import type { series as base } from '../en/series';
import type { MessageShape } from '../types';

export const series = {
  title: 'Séries',
  categories: 'Categorias',
  all: 'Todas',
  uncategorized: 'Sem categoria',
  gridLabel: (category: string) => `Séries em ${category}`,
  keyboardHint: 'Setas para mover entre séries, Enter para abrir a selecionada.',
  loadingCard: 'A carregar…',
  watched: (percent: string) => `${percent} visto`,
  seasonCount: (count: number, formatted: string) =>
    count === 1 ? '1 temporada' : `${formatted} temporadas`,
  sort: {
    label: 'Ordenar por',
    added: 'Adicionadas recentemente',
    name: 'A–Z',
    rating: 'Classificação',
  },
  noSource: {
    title: 'Ainda não tem listas IPTV',
    message: 'Adicione uma lista para ver aqui as séries.',
    add: 'Adicionar lista',
    manage: 'As minhas listas',
  },
  emptyCategory: { title: 'Esta categoria está vazia.', showAll: 'Mostrar todas as séries' },
  categoryNotFound: {
    title: 'Categoria não encontrada',
    message:
      'Esta categoria não está na lista ativa. Pode ter sido removida por uma sincronização.',
  },
  loadError: {
    title: 'Não foi possível carregar as séries',
    message: 'Tente novamente daqui a pouco.',
  },
  details: {
    back: 'Voltar às séries',
    playEpisode: (season: string, episode: string) => `Reproduzir T${season} E${episode}`,
    continueEpisode: (season: string, episode: string) => `Continuar T${season} E${episode}`,
    resumeAt: (time: string) => `Retomar aos ${time}`,
    startOver: 'Começar do início',
    addFavorite: 'Adicionar aos favoritos',
    removeFavorite: 'Remover dos favoritos',
    favoriteAdded: (name: string) => `${name} adicionada aos favoritos`,
    favoriteRemoved: (name: string) => `${name} removida dos favoritos`,
    favoriteFailed: (name: string) => `Não foi possível atualizar os favoritos de ${name}`,
    more: 'Mais',
    less: 'Menos',
    hoursMinutes: (hours: string, minutes: string) => `${hours} h ${minutes} min`,
    minutes: (minutes: string) => `${minutes} min`,
    rating: (rating: string) => `Classificação ${rating} em 10`,
    director: 'Realização',
    cast: 'Elenco',
    synopsis: 'Sinopse',
    seasonCount: (count: number, formatted: string) =>
      count === 1 ? '1 temporada' : `${formatted} temporadas`,
    season: (number: string) => `Temporada ${number}`,
    seasons: 'Temporadas',
    episodesOf: (season: string) => `Episódios da ${season}`,
    episodeCode: (number: string) => `E${number}`,
    episode: (number: string) => `Episódio ${number}`,
    watched: 'Visto',
    progress: (percent: string) => `${percent} visto`,
    infoLoading: 'A carregar os episódios…',
    infoFailed: {
      title: 'Não foi possível carregar os episódios',
      message: 'O servidor não respondeu. Tente novamente daqui a pouco.',
    },
    noEpisodes: {
      title: 'Sem episódios',
      message: 'O servidor ainda não tem episódios desta série.',
    },
    notFound: {
      title: 'Série não encontrada',
      message: 'Esta série não está na lista ativa. Pode ter sido removida por uma sincronização.',
    },
    loadError: {
      title: 'Não foi possível carregar esta série',
      message: 'Tente novamente daqui a pouco.',
    },
  },
  player: {
    loading: (name: string) => `A carregar ${name}…`,
    title: (series: string, season: string, episode: string, title: string) =>
      `${series} · T${season} E${episode} · ${title}`,
    unsupported: {
      title: 'Este episódio usa DRM / DASH, que esta aplicação não suporta',
      message: 'Emissões protegidas (DRM) e DASH não podem ser reproduzidas nesta aplicação.',
    },
    credentials: {
      title: 'Introduza novamente a palavra-passe desta lista',
      message:
        'A palavra-passe guardada já não pode ser lida neste dispositivo. Introduza-a novamente em As minhas listas para ver esta lista.',
      action: 'As minhas listas',
    },
    unavailable: {
      title: 'Este episódio não pode ser reproduzido',
      message:
        'A lista não tem um endereço de emissão válido para este episódio. Tente sincronizar a lista.',
    },
    resolveError: {
      title: 'Não foi possível iniciar este episódio',
      message: 'Tente novamente daqui a pouco.',
    },
    nextEpisode: {
      countdown: (seconds: string) => `Próximo episódio dentro de ${seconds} s`,
      label: (season: string, episode: string, title: string) =>
        `T${season} E${episode} · ${title}`,
      playNow: 'Reproduzir já',
      cancel: 'Cancelar',
    },
  },
} satisfies MessageShape<typeof base>;
