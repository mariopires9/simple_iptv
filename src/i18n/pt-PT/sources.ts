import type { sources as base } from '../en/sources';
import type { MessageShape } from '../types';

export const sources = {
  addXtream: {
    title: 'Adicionar lista Xtream',
    intro: 'Introduza os dados que o seu fornecedor lhe deu.',
    back: 'Voltar',
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
  comingSoon: {
    m3uUrl: {
      title: 'Lista M3U (URL)',
      message: 'Adicionar uma lista M3U por URL estará disponível em breve.',
    },
    m3uFile: {
      title: 'Ficheiro M3U local',
      message: 'Adicionar um ficheiro M3U local estará disponível em breve.',
    },
    back: 'Voltar',
  },
} satisfies MessageShape<typeof base>;
