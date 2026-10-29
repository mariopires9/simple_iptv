import type { onboarding as base } from '../en/onboarding';
import type { MessageShape } from '../types';

export const onboarding = {
  title: 'Bem-vindo ao Simple IPTV',
  intro: 'Ligue a sua subscrição de IPTV para começar a ver.',
  chooseType: 'Como quer adicionar a sua lista?',
  options: {
    xtream: {
      title: 'Xtream Codes',
      description: 'Servidor, utilizador e palavra-passe do seu fornecedor.',
      recommended: 'Recomendado',
    },
    m3uUrl: { title: 'Lista M3U (URL)', description: 'Um link para uma lista M3U ou M3U8.' },
    m3uFile: {
      title: 'Ficheiro M3U local',
      description: 'Um ficheiro de lista guardado neste dispositivo.',
    },
  },
  note: 'Não incluímos canais · os seus dados ficam neste dispositivo.',
  legal: 'Use apenas fontes e conteúdos a que tem autorização para aceder.',
  learnMore: 'Saber mais',
} satisfies MessageShape<typeof base>;
