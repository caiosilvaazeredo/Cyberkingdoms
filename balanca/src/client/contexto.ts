import type { Arena } from '../shared/arena';
import { LERDEZA_DO_ALDEAO, perfil, vidaMaxima } from '../shared/classes';
import {
  casaDaMoedaDe,
  nivelDe,
  bauDe,
  type Estado,
  type TipoDeItem,
  type Unidade,
} from '../shared/estado';
import {
  ALCANCE_DE_COLETA,
  ALCANCE_DE_USO,
  CUSTO_DO_NIVEL,
  NIVEL_MAXIMO,
  pesoMaximoDe,
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

/** Como cada coisa no chão se chama na dica. Ver `NOME_DA_CARGA`, no HUD. */
const NOME_DO_ITEM: Record<Exclude<TipoDeItem, 'chapeu'>, string> = {
  madeira: 'a madeira',
  ouro: 'o ouro',
  minerio: 'o minério',
  bolsa: 'a bolsa de moedas',
};

export function dicaDeUso(arena: Arena, estado: Estado, u: Unidade): Dica | null {
  const meu = u.time;
  const inimigo = outroTime(meu);
  const perto = (a: { x: number; y: number }, r: number): boolean =>
    Math.hypot(a.x - u.x, a.y - u.y) <= r;

  if (u.carga === 'bau') {
    const tesouraria = arena.estrutura('tesouraria', meu);
    if (perto(tesouraria, ALCANCE_DE_COLETA)) return { texto: 'entregar o baú', alvo: tesouraria };
    return { texto: 'largar o baú' };
  }

  if (u.carga === 'bolsa') {
    const refem = bauDe(estado, inimigo);
    const cofre = arena.estrutura('cofre', meu);
    if (refem.onde === 'cofre' && perto(cofre, ALCANCE_DE_COLETA)) {
      return refem.peso >= pesoMaximoDe(estado.porTime)
        ? { texto: 'a balança está no talo', alvo: cofre }
        : { texto: 'entulhar o baú — pesa nele, alivia o seu', alvo: cofre };
    }
    if (u.vida < vidaMaxima(u.classe, nivelDe(estado, meu))) return { texto: 'gastar a bolsa consigo' };
    return null;
  }

  if (u.carga === 'minerio') {
    const casaDaMoeda = arena.estrutura('casaDaMoeda', meu);
    if (perto(casaDaMoeda, ALCANCE_DE_COLETA)) return { texto: 'entregar o minério', alvo: casaDaMoeda };
    return null;
  }

  if (u.carga === 'madeira' || u.carga === 'ouro') {
    const chapelaria = arena.estrutura('chapelaria', meu);
    if (perto(chapelaria, ALCANCE_DE_COLETA)) {
      const oficina = estado.oficinas.find((o) => o.time === meu);
      const custo = CUSTO_DO_NIVEL[Math.min(NIVEL_MAXIMO, (oficina?.nivel ?? 1) + 1)]!;
      const falta =
        oficina && oficina.nivel < NIVEL_MAXIMO
          ? ` — falta ${Math.max(0, custo.madeira - oficina.madeira)} madeira e ${Math.max(
              0,
              custo.ouro - oficina.ouro,
            )} ouro`
          : '';
      return { texto: `entregar na obra${falta}`, alvo: chapelaria };
    }
    return null;
  }

  const item = estado.itens
    .filter((i) => perto(i, ALCANCE_DE_COLETA))
    .sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
  if (item) {
    if (item.tipo !== 'chapeu') return { texto: `pegar ${NOME_DO_ITEM[item.tipo]}`, alvo: item };
    const roubo = item.origem !== null && item.origem !== u.time;
    return {
      texto: roubo ? `roubar o chapéu de ${item.classe}` : `vestir o chapéu de ${item.classe}`,
      alvo: item,
    };
  }

  const minha = bauDe(estado, meu);
  if ((minha.onde === 'cofre' || minha.onde === 'chao') && perto(minha, ALCANCE_DE_COLETA)) {
    return { texto: 'carregar o seu baú', alvo: minha };
  }

  const casaDaMoeda = arena.estrutura('casaDaMoeda', meu);
  if (perto(casaDaMoeda, ALCANCE_DE_USO)) {
    const forno = casaDaMoedaDe(estado, meu);
    if (forno.bolsas > 0) return { texto: 'pegar uma bolsa de moedas', alvo: casaDaMoeda };
    return { texto: 'a Casa da Moeda está vazia — falta minério', alvo: casaDaMoeda };
  }

  const chapelaria = arena.estrutura('chapelaria', meu);
  if (perto(chapelaria, ALCANCE_DE_USO)) return { texto: 'trocar de chapéu', alvo: chapelaria };

  for (const j of arena.jazidas) {
    if (!perto(j, ALCANCE_DE_COLETA)) continue;
    const dela = estado.jazidas.find((x) => x.id === j.id);
    if (!dela?.cheia) continue;
    const oficio = perfil(u.classe).oficio;
    const combina = (j.tipo === 'arvore' && oficio === 'madeira') || (j.tipo === 'ouro' && oficio === 'ouro');
    const material = j.tipo === 'arvore' ? 'madeira' : 'ouro';
    return {
      texto: combina
        ? `tirar ${material}`
        : `tirar ${material} devagar — ${LERDEZA_DO_ALDEAO}× sem a ferramenta certa`,
      alvo: j,
    };
  }

  // A mula não se "usa": se derruba. A dica existe porque um saqueador novo
  // fica apertando E na frente dela esperando uma barra de progresso.
  const bicho = estado.animais.find((a) => a.vivo && perto(a, ALCANCE_DE_COLETA * 1.5));
  if (bicho) return { texto: 'derrube a mula para abrir o alforje', alvo: bicho };

  return null;
}
