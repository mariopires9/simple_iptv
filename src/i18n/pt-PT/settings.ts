import type { settings as base } from '../en/settings';
import type { MessageShape } from '../types';

export const settings = {
  sections: {
    sources: 'Listas',
    appearance: 'Aspeto',
    language: 'Idioma',
    playback: 'Reprodução',
    proxy: 'Proxy pessoal',
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
    hideProtected: 'Ocultar conteúdo protegido',
    hideProtectedHint:
      'Retira os canais, filmes e séries com DRM ou DASH, que esta aplicação não reproduz, de Direto, Filmes, Séries, da pesquisa e do Início',
    liveFormat: 'Formato preferido em direto',
    liveFormatHint: (list: string) =>
      `Para a lista ativa (${list}). Automático escolhe o que este navegador reproduz melhor.`,
    liveFormatNotXtream: 'Só as listas Xtream Codes permitem escolher o formato em direto.',
    liveFormatNoList: 'Adicione uma lista Xtream Codes para escolher o formato em direto.',
    liveFormats: { auto: 'Automático', ts: 'MPEG-TS', m3u8: 'HLS' },
    saveError: 'Não foi possível guardar a definição. Tente novamente.',
  },
  proxy: {
    intro:
      'Para fornecedores que só funcionam por HTTP: encaminhe uma lista por um proxy que executa no seu próprio computador, por exemplo acessível com o Tailscale Serve. As listas ligam-se diretamente, a menos que escolha outra opção abaixo.',
    url: 'Endereço do proxy',
    urlHint: 'O endereço HTTPS do seu proxy, por exemplo https://o-meu-pc.example.ts.net',
    token: 'Token de acesso',
    tokenHint: 'O token configurado no seu proxy',
    tokenKeep: 'Há um token guardado. Deixe este campo vazio para o manter.',
    showToken: 'Mostrar token',
    save: 'Guardar',
    test: 'Testar ligação',
    testing: 'A testar…',
    remove: 'Remover proxy',
    saved: 'Proxy guardado',
    removed: 'Proxy removido. Todas as listas voltam a ligar-se diretamente.',
    saveError: 'Não foi possível guardar o proxy. Tente novamente.',
    removeError: 'Não foi possível remover o proxy. Tente novamente.',
    testError: 'Não foi possível fazer o teste. Tente novamente.',
    errors: {
      baseUrl: {
        empty: 'Introduza o endereço do seu proxy.',
        invalid: 'Introduza um endereço válido, começado por https://.',
        'too-long': 'Este endereço é demasiado longo.',
        insecure:
          'O endereço tem de usar HTTPS (http:// só funciona para este próprio dispositivo).',
        credentials: 'Retire o nome de utilizador e a palavra-passe do endereço.',
        query: 'Retire do endereço a parte a seguir a ? ou #.',
      },
      token: {
        required: 'Introduza o token configurado no seu proxy.',
        invalid: 'O token tem entre 32 e 128 carateres: letras, algarismos, - ou _.',
      },
    },
    outcomes: {
      ok: (streams: string) =>
        `O seu proxy respondeu. Emissões que está a retransmitir agora: ${streams}.`,
      okList: (list: string, streams: string) =>
        `O seu proxy respondeu e permite o servidor de ${list}. Emissões que está a retransmitir agora: ${streams}.`,
      auth: 'O proxy rejeitou o token. Confirme que é o que está configurado no proxy.',
      unreachable:
        'Não foi possível contactar o proxy. Confirme que o Tailscale está ligado neste dispositivo, que o endereço usa HTTPS e que o computador onde o proxy corre está ligado, com o proxy iniciado.',
      notProxy: 'Este endereço não responde como um proxy do Simple IPTV. Confirme o endereço.',
      notAllowed: (list: string) =>
        `O proxy funciona, mas o servidor de ${list} não está na lista de anfitriões permitidos. Acrescente-o à lista de permissões do proxy.`,
    },
    routing: {
      title: 'Listas',
      hint: 'Só emissões: o leitor passa pelo proxy. Emissões e API: também as transferências e o guia de programação da lista.',
      disabledHint: 'Guarde um proxy para encaminhar listas por ele.',
      noLists: 'Ainda não tem listas.',
      label: (list: string) => `Proxy para ${list}`,
      options: { off: 'Desligado (direto)', streams: 'Só emissões', all: 'Emissões e API' },
      saveError: 'Não foi possível guardar a definição da lista. Tente novamente.',
    },
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
    deleteAll: {
      title: 'Apagar todos os dados',
      description:
        'Remove deste dispositivo todas as listas, palavras-passe, canais, favoritos, histórico de visualização e definições. A aplicação continua instalada. Esta ação não pode ser anulada.',
      action: 'Apagar todos os dados…',
      dialog: {
        title: 'Apagar todos os dados?',
        message:
          'Tudo o que esta aplicação guardou neste dispositivo é apagado e a aplicação recomeça do início. As suas subscrições não são afetadas.',
        confirmWord: 'APAGAR',
        confirmLabel: (word: string) => `Escreva ${word} para confirmar`,
        confirm: 'Apagar tudo',
        deleting: 'A apagar…',
      },
      failed: {
        title: 'Não foi possível apagar alguns dados',
        message:
          'Tente novamente. Se continuar a falhar, feche primeiro esta aplicação noutros separadores ou janelas e tente de novo.',
        partsTitle: 'Não apagado:',
        parts: {
          database: 'Listas, canais, favoritos e definições',
          caches: 'Ficheiros em cache',
          storage: 'Preferências guardadas pelo navegador (idioma, tema)',
        },
        deletedNote:
          'As suas listas, canais e definições foram apagados. A aplicação recomeça do início quando continuar.',
        pendingNote:
          'A eliminação aguarda que esta aplicação seja fechada noutros separadores ou janelas. Termina sozinha assim que forem fechados.',
        retry: 'Tentar novamente',
        close: 'Fechar',
        continue: 'Continuar',
      },
    },
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
