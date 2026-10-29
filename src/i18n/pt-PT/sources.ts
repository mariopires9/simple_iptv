import type { sources as base } from '../en/sources';
import type { MessageShape } from '../types';

export const sources = {
  addXtream: {
    title: 'Adicionar lista Xtream',
    intro: 'Introduza os dados que o seu fornecedor lhe deu.',
    back: 'Voltar',
    prefilled:
      'Os dados foram preenchidos a partir do endereço da sua lista. Verifique-os e depois teste e guarde.',
  },
  addM3uUrl: {
    title: 'Adicionar lista M3U (URL)',
    intro: 'Cole o endereço da sua lista M3U. É descarregada e lida apenas neste dispositivo.',
    back: 'Voltar',
    fields: {
      url: 'Endereço da lista (URL)',
      urlHelp: 'Por exemplo https://exemplo.com/lista.m3u',
      name: 'Nome (opcional)',
      nameHelp: 'Se ficar vazio, é usado o nome do servidor.',
    },
    validation: {
      urlRequired: 'Introduza o endereço da lista.',
      url: {
        empty: 'Introduza o endereço da lista.',
        invalid: 'Este endereço não é válido.',
        scheme: 'O endereço tem de começar por http:// ou https://.',
        'too-long': 'Este endereço é demasiado longo.',
        credentials:
          'Endereços com utilizador e palavra-passe antes do nome do servidor (utilizador:senha@…) não são suportados.',
      },
    },
    submit: 'Importar',
    xtreamSuggestion: {
      title: 'Este URL parece ser de um servidor Xtream',
      message:
        'Use o modo Xtream (recomendado): carrega mais detalhes e só a sua palavra-passe é guardada, cifrada, em vez do endereço de cada canal.',
      action: 'Usar modo Xtream',
    },
    steps: {
      saving: 'A guardar…',
      download: 'A descarregar a lista…',
      write: 'A guardar os canais…',
    },
    progress: {
      downloaded: (size: string) => `${size} descarregados`,
      downloadedOf: (size: string, total: string) => `${size} de ${total} descarregados`,
      entries: (count: string) => `${count} entradas lidas`,
    },
    result: {
      title: 'Lista importada',
      live: (n: string) => `Canais: ${n}`,
      movies: (n: string) => `Filmes: ${n}`,
      series: (n: string) => `Episódios de séries: ${n}`,
      skipped: (n: string) => `${n} entradas não puderam ser usadas e foram ignoradas.`,
      continue: 'Continuar',
    },
    errors: {
      'not-m3u': {
        title: 'Não é uma lista M3U',
        message: 'O URL não devolveu uma lista M3U.',
      },
      'empty-list': {
        title: 'Sem canais utilizáveis',
        message: 'A lista foi lida, mas não tem entradas que esta aplicação possa usar.',
      },
      'too-large': {
        title: 'Lista demasiado grande',
        message: 'Esta lista é demasiado grande para carregar neste dispositivo.',
      },
      auth: {
        title: 'Acesso recusado',
        message: 'O servidor recusou o acesso à lista. O endereço pode ter expirado.',
      },
      'invalid-url': {
        title: 'Endereço da lista inválido',
        message: 'O endereço guardado não é válido. Apague esta lista e adicione-a novamente.',
      },
      'credentials-lost': {
        title: 'Endereço da lista indisponível',
        message:
          'O endereço guardado já não pode ser lido neste dispositivo. Apague esta lista e adicione-a novamente.',
      },
      storage: {
        title: 'Não foi possível guardar os canais',
        message: 'O armazenamento do dispositivo recusou os dados (pode estar cheio).',
      },
    },
    localFile: {
      message:
        'Este browser não consegue descarregar a lista. Descarregue-a com outra aplicação e depois adicione o ficheiro.',
      action: 'Adicionar um ficheiro local',
    },
    retry: 'Tentar novamente',
    delete: 'Apagar esta lista',
    toasts: {
      imported: 'Lista importada.',
      deleted: 'Lista apagada.',
    },
  },
  addM3uFile: {
    title: 'Adicionar ficheiro M3U local',
    intro:
      'Escolha um ficheiro M3U ou M3U8 guardado neste dispositivo. É lido apenas neste dispositivo e só são guardados os canais que contém.',
    back: 'Voltar',
    fields: {
      file: 'Ficheiro da lista',
      choose: 'Escolher ficheiro',
      change: 'Escolher outro ficheiro',
      none: 'Nenhum ficheiro escolhido',
      chosen: (name: string, size: string) => `${name} (${size})`,
      fileHelp: 'Um ficheiro .m3u ou .m3u8.',
      name: 'Nome (opcional)',
      nameHelp: 'Se ficar vazio, é usado o nome do ficheiro.',
    },
    validation: {
      fileRequired: 'Escolha um ficheiro.',
    },
    submit: 'Importar',
    steps: {
      saving: 'A guardar…',
      read: 'A ler o ficheiro…',
      write: 'A guardar os canais…',
    },
    progress: {
      readOf: (size: string, total: string) => `${size} de ${total} lidos`,
    },
    largeFile: {
      title: 'Ficheiro grande',
      message: (size: string) =>
        `Este ficheiro tem ${size}. A leitura pode demorar vários minutos e usar muita memória e, em alguns dispositivos, pode não terminar.`,
      confirm: 'Importar mesmo assim',
    },
    errors: {
      'not-m3u': {
        title: 'Não é uma lista M3U',
        message: 'O ficheiro não é uma lista M3U.',
      },
      'file-unreadable': {
        title: 'Não foi possível ler o ficheiro',
        message:
          'Não foi possível ler o ficheiro. Pode ter sido movido, apagado ou alterado. Escolha-o novamente.',
      },
    },
  },
  fields: {
    name: 'Nome (opcional)',
    nameHelp: 'Se ficar vazio, é usado o nome do servidor.',
    server: 'Servidor',
    serverHelp: 'Por exemplo http://exemplo.com:8080',
    username: 'Utilizador',
    password: 'Palavra-passe',
    showPassword: 'Mostrar palavra-passe',
  },
  validation: {
    serverRequired: 'Introduza o endereço do servidor.',
    usernameRequired: 'Introduza o utilizador.',
    passwordRequired: 'Introduza a palavra-passe.',
    serverUrl: {
      empty: 'Introduza o endereço do servidor.',
      invalid: 'Este endereço de servidor não é válido.',
      scheme: 'O endereço tem de começar por http:// ou https://.',
      'too-long': 'Este endereço é demasiado longo.',
      credentials:
        'Não coloque o utilizador nem a palavra-passe no endereço: use os campos abaixo.',
    },
  },
  submit: 'Testar e guardar',
  steps: {
    contacting: 'A contactar o servidor…',
    validating: 'A validar a conta…',
    saving: 'A guardar…',
  },
  result: {
    title: 'Ligação estabelecida',
    status: (status: string) => `Estado da conta: ${status}`,
    expires: (date: string) => `Válida até ${date}`,
    noExpiry: 'Sem data de expiração',
    connections: (active: string, max: string) => `Ligações em uso: ${active} de ${max}`,
    maxConnections: (max: string) => `Ligações permitidas: ${max}`,
    warningsTitle: 'A ter em conta',
    continue: 'Ir para o Início',
  },
  fixesTitle: 'O que pode fazer',
  saveAnyway: 'Guardar mesmo assim',
  saveAnywayHint:
    'Pode guardar a lista agora, mas os canais não carregam a partir desta página até o problema ser resolvido.',
  toasts: {
    saved: 'Lista guardada.',
    syncing: 'A carregar os seus canais…',
    savedWithError:
      'Lista guardada. Os canais carregam quando o problema de ligação for resolvido.',
  },
  problems: {
    'auth-failed': {
      title: 'Início de sessão recusado',
      message: 'O servidor recusou o utilizador ou a palavra-passe.',
    },
    'account-expired': { title: 'Conta expirada', message: 'Esta subscrição expirou.' },
    'account-banned': {
      title: 'Conta bloqueada',
      message: 'O fornecedor bloqueou esta conta.',
    },
    'account-disabled': {
      title: 'Conta desativada',
      message: 'O fornecedor desativou esta conta.',
    },
    'account-inactive': { title: 'Conta inativa', message: 'Esta conta não está ativa.' },
    'max-connections-reached': {
      title: 'Todas as ligações em uso',
      message:
        'Todas as ligações permitidas pela subscrição estão em uso. A reprodução pode falhar até uma ficar livre.',
    },
    offline: { title: 'Está sem ligação', message: 'Não há ligação à rede.' },
    timeout: {
      title: 'O servidor demorou demasiado',
      message: 'O servidor não respondeu a tempo.',
    },
    'blocked-mixed-content': {
      title: 'Endereço de servidor inseguro',
      message:
        'Este servidor usa HTTP, que os browsers bloqueiam numa página segura (HTTPS), e nenhum endereço HTTPS respondeu.',
    },
    'blocked-cors': {
      title: 'O servidor não permite aplicações web',
      message:
        'O browser bloqueou o pedido: o servidor não permite aplicações web (CORS) ou não foi possível contactá-lo.',
    },
    'network-error': {
      title: 'Servidor inacessível',
      message: 'O pedido não foi concluído.',
    },
    'http-error': {
      title: 'Resposta inesperada do servidor',
      message: 'O servidor devolveu uma resposta inesperada.',
    },
    'invalid-response': {
      title: 'Não é um servidor Xtream',
      message: 'O servidor não respondeu como um painel Xtream Codes.',
    },
    'http-only': {
      title: 'Servidor só HTTP',
      message: 'Este servidor só funciona por HTTP. Os canais podem não reproduzir no browser.',
    },
    'https-unavailable': {
      title: 'HTTPS não funciona',
      message: 'O servidor indica uma porta HTTPS, mas o HTTPS não funcionou. É usado HTTP.',
    },
  },
  fixes: {
    'check-credentials': 'Verifique o utilizador e a palavra-passe (maiúsculas contam).',
    'renew-subscription': 'Renove a subscrição junto do seu fornecedor.',
    'contact-provider': 'Contacte o seu fornecedor.',
    'close-other-players': 'Feche a aplicação noutros dispositivos e tente novamente.',
    'check-network': 'Verifique a ligação à rede.',
    'retry-later': 'Tente novamente daqui a alguns minutos.',
    'check-server-url': 'Verifique o endereço do servidor, incluindo a porta.',
    'see-connection-options': 'Pergunte ao seu fornecedor se o servidor tem um endereço HTTPS.',
    'use-https': 'Use o endereço HTTPS do servidor, se o fornecedor o disponibilizar.',
    'use-local-file': 'Descarregue a lista M3U e adicione-a como ficheiro local.',
    'use-proxy': 'Use um proxy que sirva este servidor por HTTPS.',
  },
  myLists: {
    title: 'As minhas listas',
    add: 'Adicionar lista',
    loadError: {
      title: 'Não foi possível carregar as suas listas',
      message: 'Não foi possível ler as suas listas neste dispositivo.',
    },
    empty: {
      title: 'Ainda não tem listas IPTV',
      message: 'Adicione uma lista Xtream ou M3U para começar a ver.',
    },
    active: 'Ativa',
    kinds: { xtream: 'Xtream', 'm3u-url': 'M3U (URL)', 'm3u-file': 'M3U (ficheiro)' },
    counts: {
      channels: (count: number, formatted: string) =>
        count === 1 ? '1 canal' : `${formatted} canais`,
      movies: (count: number, formatted: string) =>
        count === 1 ? '1 filme' : `${formatted} filmes`,
      series: (count: number, formatted: string) =>
        count === 1 ? '1 série' : `${formatted} séries`,
    },
    updated: (when: string) => `Atualizada ${when}`,
    neverUpdated: 'Nunca atualizada',
    contentTypes: { live: 'canais', movie: 'filmes', series: 'séries' },
    status: {
      never: 'Ainda não carregada',
      syncing: 'A atualizar…',
      ok: 'Atualizada',
      partial: (types: string, reason: string) =>
        `Parte do conteúdo não foi atualizada (${types}): ${reason}`,
      error: (reason: string) => `A atualização falhou: ${reason}`,
    },
    reasons: {
      offline: 'sem ligação à rede',
      timeout: 'o servidor demorou demasiado',
      blocked: 'o browser bloqueou o servidor',
      'blocked-mixed-content': 'endereço de servidor inseguro (HTTP)',
      http: 'resposta inesperada do servidor',
      auth: 'acesso recusado',
      parse: 'resposta do servidor ilegível',
      'account-inactive': 'a conta não está ativa',
      'invalid-response': 'o servidor não respondeu como esperado',
      'empty-response': 'o servidor devolveu uma lista vazia',
      'server-unreachable': 'servidor inacessível',
      storage: 'o armazenamento do dispositivo está cheio ou indisponível',
      'credentials-lost': 'as credenciais guardadas já não podem ser lidas — edite a lista',
      'not-m3u': 'não é uma lista M3U',
      'empty-list': 'a lista não tem entradas utilizáveis',
      'too-large': 'a lista é demasiado grande',
      'invalid-url': 'endereço da lista inválido',
      'file-unreadable': 'não foi possível ler o ficheiro — atualize-a com o ficheiro',
      unknown: 'erro desconhecido',
    },
    actions: {
      use: 'Usar esta',
      refresh: 'Atualizar',
      edit: 'Editar',
      remove: 'Remover',
    },
    phases: {
      starting: 'A iniciar a atualização…',
      auth: 'A iniciar sessão…',
      'live-categories': 'A carregar categorias de canais…',
      live: 'A carregar canais…',
      'movie-categories': 'A carregar categorias de filmes…',
      movie: 'A carregar filmes…',
      'series-categories': 'A carregar categorias de séries…',
      series: 'A carregar séries…',
      download: 'A descarregar a lista…',
      read: 'A ler o ficheiro…',
      parse: 'A ler a lista…',
      write: 'A guardar canais…',
      done: 'A terminar…',
    },
    toasts: {
      switched: (name: string) => `A usar «${name}».`,
      removed: (name: string) => `«${name}» removida.`,
      removeFailed: (name: string) => `Não foi possível remover «${name}».`,
      refreshed: (name: string) => `«${name}» atualizada.`,
      refreshPartial: (name: string) => `«${name}» foi atualizada apenas em parte.`,
      refreshFailed: (name: string) => `Não foi possível atualizar «${name}».`,
      refreshUnavailable: 'Não foi possível iniciar a atualização.',
      updated: 'Lista atualizada.',
    },
    refreshFile: {
      title: (name: string) => `Atualizar «${name}»`,
      message:
        'Esta lista foi adicionada a partir de um ficheiro, por isso não pode ser descarregada novamente. Escolha o ficheiro atualizado para a atualizar. Os favoritos e o histórico são mantidos.',
      choose: 'Escolher ficheiro',
    },
    remove: {
      title: (name: string) => `Remover «${name}»?`,
      message:
        'Os canais, filmes, séries, favoritos e histórico desta lista são apagados deste dispositivo. A sua subscrição não é afetada.',
      confirm: 'Remover',
    },
  },
  edit: {
    title: 'Editar lista',
    back: 'Voltar',
    notFound: {
      title: 'Lista não encontrada',
      message: 'Esta lista já não existe neste dispositivo.',
    },
    loadError: {
      title: 'Não foi possível carregar esta lista',
      message: 'Tente novamente daqui a pouco.',
    },
    name: 'Nome',
    nameHelp: 'Se ficar vazio, é usado o nome do servidor.',
    passwordKeepHelp: 'Deixe vazio para manter a palavra-passe atual.',
    passwordLost:
      'A palavra-passe guardada já não pode ser lida neste dispositivo. Introduza-a novamente.',
    save: 'Guardar',
    saveAndTest: 'Testar e guardar',
  },
} satisfies MessageShape<typeof base>;
