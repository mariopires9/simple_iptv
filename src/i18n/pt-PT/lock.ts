// SEC-02: master password — the unlock screen and its section in Settings › Privacy (pt-PT).
import type { lock as base } from '../en/lock';
import type { MessageShape } from '../types';

export const lock = {
  screen: {
    title: 'O Simple IPTV está bloqueado',
    message: 'Introduza a palavra-passe mestra para usar as suas listas.',
    password: 'Palavra-passe mestra',
    unlock: 'Desbloquear',
    unlocking: 'A desbloquear…',
    wrong: 'Esta não é a palavra-passe mestra. Tente novamente.',
    failed: 'Não foi possível desbloquear a aplicação. Tente novamente.',
    forgotTitle: 'Esqueceu-se da palavra-passe mestra?',
    forgotMessage:
      'Não é possível recuperá-la. A única saída é apagar todos os dados neste dispositivo e voltar a adicionar as suas listas.',
  },
  settings: {
    title: 'Palavra-passe mestra',
    descriptionOff:
      'Proteja as suas palavras-passe e endereços de listas com uma palavra-passe que só você conhece. A aplicação pede-a ao abrir e após algum tempo em segundo plano.',
    descriptionOn:
      'As suas palavras-passe e endereços de listas estão cifrados com a sua palavra-passe mestra. A aplicação pede-a ao abrir e após algum tempo em segundo plano.',
    enable: 'Definir palavra-passe mestra…',
    disable: 'Desativar a palavra-passe mestra…',
    lockNow: 'Bloquear agora',
    lockAfter: 'Bloquear após, em segundo plano',
    lockAfterChoice: (minutes: number) =>
      minutes === 0 ? 'Imediatamente' : minutes === 1 ? '1 minuto' : `${minutes} minutos`,
    saveError: 'Não foi possível guardar a definição. Tente novamente.',
    enableDialog: {
      title: 'Definir palavra-passe mestra',
      warning:
        'Não há forma de recuperar uma palavra-passe mestra esquecida. Se a esquecer, terá de apagar todos os dados neste dispositivo e voltar a adicionar as suas listas.',
      password: 'Palavra-passe mestra',
      passwordHint: (min: number) => `Pelo menos ${min} caracteres`,
      confirm: 'Repita a palavra-passe mestra',
      mismatch: 'As palavras-passe não coincidem',
      tooShort: (min: number) => `Use pelo menos ${min} caracteres`,
      understand: 'Compreendo que uma palavra-passe mestra esquecida não pode ser recuperada',
      submit: 'Definir palavra-passe mestra',
      working: 'A cifrar as suas credenciais…',
      failed: 'Não foi possível definir a palavra-passe mestra. Nada foi alterado.',
    },
    disableDialog: {
      title: 'Desativar a palavra-passe mestra?',
      message:
        'As suas palavras-passe e endereços de listas voltam a ser cifrados com a chave deste navegador. Introduza a palavra-passe mestra para confirmar.',
      password: 'Palavra-passe mestra',
      submit: 'Desativar',
      working: 'A cifrar novamente as suas credenciais…',
      wrong: 'Esta não é a palavra-passe mestra.',
      failed: 'Não foi possível desativar a palavra-passe mestra. Nada foi alterado.',
    },
  },
} satisfies MessageShape<typeof base>;
