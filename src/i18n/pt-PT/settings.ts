import type { settings as base } from '../en/settings';
import type { MessageShape } from '../types';

export const settings = {
  sections: {
    sources: 'Listas',
    appearance: 'Aspeto',
    language: 'Idioma',
    playback: 'Reprodução',
    storage: 'Armazenamento',
    privacy: 'Privacidade',
    about: 'Acerca',
  },
  sources: {
    myLists: 'As minhas listas',
    myListsHint: 'Adicionar, alternar, atualizar ou remover as suas listas IPTV',
  },
  appearance: {
    theme: 'Tema',
  },
  language: {
    label: 'Idioma da interface',
    system: (current: string) => `Sistema (${current})`,
    names: { en: 'English', 'pt-PT': 'Português' },
  },
  playback: {
    fullscreenOnLandscape: 'Ecrã inteiro na horizontal',
    fullscreenOnLandscapeHint:
      'Em telemóveis e tablets, rodar o dispositivo durante a reprodução sugere o ecrã inteiro',
    playLastChannel: 'Reproduzir o último canal ao abrir',
    playLastChannelHint: 'Quando a TV em direto abre, começa o último canal que viu',
    liveFormat: 'Formato preferido em direto',
    liveFormatHint: (list: string) =>
      `Para a lista ativa (${list}). Automático escolhe o que este navegador reproduz melhor.`,
    liveFormatNotXtream: 'Só as listas Xtream Codes permitem escolher o formato em direto.',
    liveFormatNoList: 'Adicione uma lista Xtream Codes para escolher o formato em direto.',
    liveFormats: { auto: 'Automático', ts: 'MPEG-TS', m3u8: 'HLS' },
    saveError: 'Não foi possível guardar a definição. Tente novamente.',
  },
  storage: {
    persisted: 'Armazenamento persistente',
    persistedOn: 'Ativo: o navegador não apaga os dados da aplicação para libertar espaço.',
    persistedOff:
      'Inativo: o navegador pode apagar os dados da aplicação quando o dispositivo tiver pouco espaço.',
    persistedUnknown: 'Este navegador não indica se os dados são mantidos.',
    request: 'Pedir novamente',
    requestDenied: 'O navegador não o permitiu. Instalar a aplicação costuma ajudar.',
    usage: 'Espaço utilizado',
    usageOf: (used: string, quota: string) => `${used} de ${quota}`,
    usageUnknown: 'Este navegador não indica o espaço utilizado.',
    iosInstall:
      'Instale a aplicação para evitar que o Safari apague os seus dados após 7 dias sem utilização',
  },
  privacy: {
    title: 'Privacidade e dados',
    summary: 'Tudo fica neste dispositivo. Não há conta, rastreio nem estatísticas de utilização.',
    storage:
      'As suas credenciais são guardadas apenas neste dispositivo, cifradas. Isto impede a leitura casual dos dados da aplicação, mas não protege contra alguém com acesso ao seu dispositivo desbloqueado. As credenciais também fazem parte dos endereços dos canais, que são enviados ao seu fornecedor. Pode apagar tudo em Definições › Privacidade.',
    noChannels:
      'O Simple IPTV é um leitor: não fornece, aloja nem sugere canais ou listas. Não há rastreio nem estatísticas de utilização.',
    whatWeStore: 'O que fica guardado neste dispositivo',
    stored: {
      lists: 'As suas listas: nome, endereço do servidor e nome de utilizador.',
      credentials:
        'Palavras-passe e endereços das listas, cifrados com uma chave que nunca sai deste navegador.',
      catalog: 'Os canais, filmes, séries e o guia de programação descarregados das suas listas.',
      personal: 'Favoritos, histórico de visualização e pesquisas recentes.',
      preferences: 'Definições como o tema, o idioma e o último canal.',
    },
    notSent:
      'Nada nos é enviado: a aplicação só comunica com os servidores das listas que adicionar. Para remover uma lista e os seus dados, use As minhas listas.',
  },
  about: {
    version: 'Versão',
    licenses: 'Licenças de código aberto',
    licensesHint: 'O software de código aberto com que esta aplicação é feita',
    licensesLoading: 'A carregar as licenças…',
    licensesUnavailable: 'A lista de licenças não está disponível nesta versão.',
    legal:
      'A aplicação não fornece conteúdos; apenas usa fontes a que tem autorização para aceder.',
  },
} satisfies MessageShape<typeof base>;
