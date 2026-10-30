import type { parental as base } from '../en/parental';
import type { MessageShape } from '../types';

export const parental = {
  restrictedCategory: (name: string) => `${name} (restrita)`,
  gate: {
    title: 'Conteúdo restrito',
    message: 'Este conteúdo está protegido pelo PIN do controlo parental.',
    unlock: 'Introduzir PIN',
  },
  prompt: {
    title: 'Introduza o PIN',
    pin: 'PIN',
    unlock: 'Desbloquear',
    cancel: 'Cancelar',
    wrong: 'PIN errado. Tente novamente.',
    error: 'Não foi possível verificar o PIN. Tente novamente.',
  },
  settings: {
    title: 'Controlo parental',
    intro:
      'Defina um PIN e escolha as categorias de TV em direto, Filmes e Séries que ele protege. As categorias restritas e os seus itens pedem o PIN antes de serem mostrados ou reproduzidos, e ficam ocultos da pesquisa e do Início enquanto bloqueados.',
    deterrent:
      'Isto é um dissuasor, não uma proteção forte: alguém com acesso a este dispositivo consegue contorná-lo, por exemplo apagando os dados da aplicação.',
    statusOff: 'Nenhum PIN definido.',
    statusLocked: 'Bloqueado: o conteúdo restrito precisa do PIN.',
    statusUnlocked: 'Desbloqueado até a aplicação ser fechada ou bloqueada novamente.',
    setPin: 'Definir PIN',
    changePin: 'Alterar PIN',
    removePin: 'Remover PIN',
    lockNow: 'Bloquear agora',
    unlock: 'Desbloquear para editar',
    newPin: 'Novo PIN',
    newPinHint: '4 a 8 dígitos',
    confirmPin: 'Repita o novo PIN',
    currentPin: 'PIN atual',
    save: 'Guardar',
    cancel: 'Cancelar',
    invalidPin: 'O PIN tem de ter 4 a 8 dígitos.',
    mismatch: 'Os dois PIN são diferentes.',
    wrongPin: 'PIN errado.',
    saveError: 'Não foi possível guardar a alteração. Tente novamente.',
    pinSaved: 'PIN guardado',
    pinRemoved: 'PIN removido',
    removeTitle: 'Remover o PIN',
    removeMessage: 'Todas as categorias voltam a ficar visíveis e as restrições são esquecidas.',
    categories: 'Categorias restritas',
    categoriesHint: (list: string) => `Da lista ativa (${list}).`,
    categoriesNoList: 'Adicione uma lista para escolher as suas categorias.',
    categoriesLocked: 'Desbloqueie para ver ou alterar as categorias restritas.',
    types: { live: 'TV em direto', movie: 'Filmes', series: 'Séries' },
    choose: (type: string, count: number) =>
      count === 0
        ? `${type}: nenhuma restrita`
        : `${type}: ${count} ${count === 1 ? 'restrita' : 'restritas'}`,
    pickerTitle: (type: string) => `Categorias restritas de ${type}`,
    pickerEmpty: 'Esta lista não tem categorias deste tipo.',
    uncategorized: 'Sem categoria',
    categoriesSaved: 'Categorias restritas guardadas',
    forgot:
      'Esqueceu o PIN? Não é possível recuperá-lo: a única forma de o remover é apagar todos os dados.',
    forgotLink: 'Apagar todos os dados',
  },
} satisfies MessageShape<typeof base>;
