import type { Arena } from '../shared/arena';
import { perfil } from '../shared/classes';
import { cozinhaDe, princesaDe, type Estado, type Unidade } from '../shared/estado';
import {
  ALCANCE_DE_COLETA,
  ALCANCE_DE_USO,
  PESO_MAXIMO,
  outroTime,
} from '../shared/regras';

/**
 * O que o botão de contexto vai fazer, dito em português.
 *
 * ## Um espelho, e por que ele é aceitável
 *
 * Esta função repete a ordem de decisão de `usar`, no servidor. Repetição de
 * regra é dívida, e esta é assumida de propósito: a alternativa seria o
 * servidor mandar a dica dentro do retrato, o que gastaria banda a 15 Hz para
 * dizer algo que o cliente já tem todos os dados para concluir.
 *
 * O contrato é estreito e está escrito aqui: **se as duas ordens divergirem, a
 * do servidor vence e o jogador vê uma dica errada.** Por isso as duas listas
 * estão na mesma ordem, e mexer numa sem a outra é o tipo de coisa que o teste
 * de dica pega.
 */

export interface Dica {
  texto: string;
  /** Onde desenhar o realce, quando houver um alvo no mundo. */
  alvo?: { x: number; y: number };
}

export function dicaDeUso(arena: Arena, estado: Estado, u: Unidade): Dica | null {
  const meu = u.time;
  const inimigo = outroTime(meu);
  const perto = (a: { x: number; y: number }, r: number): boolean =>
    Math.hypot(a.x - u.x, a.y - u.y) <= r;

  if (u.carga === 'princesa') {
    const trono = arena.estrutura('trono', meu);
    if (perto(trono, ALCANCE_DE_COLETA)) return { texto: 'entregar a princesa', alvo: trono };
    return { texto: 'largar a princesa' };
  }

  if (u.carga === 'bolo') {
    const refem = princesaDe(estado, inimigo);
    const jaula = arena.estrutura('jaula', meu);
    if (refem.onde === 'jaula' && perto(jaula, ALCANCE_DE_COLETA)) {
      return refem.peso >= PESO_MAXIMO
        ? { texto: 'a balança está no talo', alvo: jaula }
        : { texto: 'dar a fatia — pesa nela, alivia a sua', alvo: jaula };
    }
    if (u.vida < perfil(u.classe).vida) return { texto: 'comer o bolo' };
    return null;
  }

  if (u.carga === 'trigo') {
    const cozinha = arena.estrutura('cozinha', meu);
    if (perto(cozinha, ALCANCE_DE_COLETA)) return { texto: 'entregar o trigo', alvo: cozinha };
    return null;
  }

  const item = estado.itens
    .filter((i) => perto(i, ALCANCE_DE_COLETA))
    .sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
  if (item) {
    if (item.tipo === 'bolo') return { texto: 'pegar o bolo', alvo: item };
    const roubo = item.origem !== null && item.origem !== u.time;
    return {
      texto: roubo ? `roubar o chapéu de ${item.classe}` : `vestir o chapéu de ${item.classe}`,
      alvo: item,
    };
  }

  const minha = princesaDe(estado, meu);
  if ((minha.onde === 'jaula' || minha.onde === 'chao') && perto(minha, ALCANCE_DE_COLETA)) {
    return { texto: 'carregar a sua princesa', alvo: minha };
  }

  const cozinha = arena.estrutura('cozinha', meu);
  if (perto(cozinha, ALCANCE_DE_USO)) {
    const forno = cozinhaDe(estado, meu);
    if (forno.bolos > 0) return { texto: 'pegar um bolo', alvo: cozinha };
    return { texto: 'a cozinha está vazia — falta trigo', alvo: cozinha };
  }

  const chapelaria = arena.estrutura('chapelaria', meu);
  if (perto(chapelaria, ALCANCE_DE_USO)) return { texto: 'trocar de chapéu', alvo: chapelaria };

  if (perfil(u.classe).colhe) {
    for (const t of arena.trigais) {
      if (!perto(t, ALCANCE_DE_COLETA)) continue;
      const estadoDoTrigal = estado.trigais.find((x) => x.id === t.id);
      if (estadoDoTrigal?.maduro) return { texto: 'colher trigo', alvo: t };
    }
  }
  return null;
}
