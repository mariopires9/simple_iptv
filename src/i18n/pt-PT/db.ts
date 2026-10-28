// Mensagens de erro da camada de persistência (core/db) — a UI converte `reason` em texto.
import type { DatabaseUnavailableReason } from '@/core/db';

export const dbErrors: Record<DatabaseUnavailableReason, string> = {
  unsupported:
    'Este browser não permite guardar dados no dispositivo. Se estiver em navegação privada, abra a app numa janela normal.',
  'open-failed':
    'Não foi possível aceder ao armazenamento do dispositivo. Se estiver em navegação privada, abra a app numa janela normal ou permita que este site guarde dados.',
  timeout:
    'O armazenamento do dispositivo não respondeu. Feche outros separadores com a app e tente novamente.',
};
