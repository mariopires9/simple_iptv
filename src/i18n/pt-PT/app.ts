import type { app as base } from '../en/app';
import type { MessageShape } from '../types';

export const app = {
  name: 'Simple IPTV',
  update: {
    available: 'Nova versão disponível',
    action: 'Atualizar',
  },
  startup: {
    preparing: 'A preparar os seus dados…',
  },
} satisfies MessageShape<typeof base>;
