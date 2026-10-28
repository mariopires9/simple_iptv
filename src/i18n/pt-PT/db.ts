import type { db as base } from '../en/db';
import type { MessageShape } from '../types';

export const db = {
  errors: {
    unsupported:
      'Este browser não permite guardar dados no dispositivo. Se estiver em navegação privada, abra a app numa janela normal.',
    'open-failed':
      'Não foi possível aceder ao armazenamento do dispositivo. Se estiver em navegação privada, abra a app numa janela normal ou permita que este site guarde dados.',
    timeout:
      'O armazenamento do dispositivo não respondeu. Feche outros separadores com a app e tente novamente.',
  },
} satisfies MessageShape<typeof base>;
