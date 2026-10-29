import type { install as base } from '../en/install';
import type { MessageShape } from '../types';

// Install the app (PWA-01 AC3): the section shown in Settings.
export const install = {
  title: 'Instalar app',
  description:
    'Instale o Simple IPTV para o abrir a partir do ecrã principal ou da lista de apps, como uma app normal.',
  button: 'Instalar app',
  dismissed: 'Instalação cancelada.',
  installed: 'O Simple IPTV está instalado neste dispositivo.',
  ios: {
    intro: 'Para instalar no iPhone ou iPad:',
    share: 'Toque em Partilhar na barra do navegador.',
    addToHomeScreen: 'Escolha "Adicionar ao ecrã principal".',
  },
} satisfies MessageShape<typeof base>;
