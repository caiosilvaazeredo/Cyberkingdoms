import { CLASSES_COM_CHAPEU, type Classe } from './classes';

/**
 * A Regência: o Peso do Tesouro de sempre, jogado como uma corrente de
 * batalhas contra um reino bandido só de bots — sozinho ou em grupo, cada
 * vitória deixa o time mais forte, e a derrota zera a corrente.
 *
 * ## O que muda em cada nível, e o que não muda
 *
 * Nenhuma fórmula de combate é tocada. O único efeito de um nível é engordar
 * o estoque da chapelaria — mais chapéis de uma classe esperando prontos — de
 * um lado e do outro. É a alavanca mais barata que o jogo já tinha: zero
 * mudança em `partida.ts`, zero risco aos números que `documentacao.test.ts`
 * já garante contra o README.
 *
 * ## Por que o reforço é automático, e não uma escolha
 *
 * Uma tela de "escolha seu perk" pede protocolo novo, um prazo de decisão e
 * um jeito de não travar quando ninguém decide — three problemas para
 * resolver antes da primeira partida rodar. O reforço automático entrega a
 * mesma sensação de "ficar mais forte a cada vitória" com uma linha de
 * `Sala.avancarCampanha`. Trocar por escolha de verdade é o passo natural
 * seguinte, não o primeiro.
 *
 * ## Por que o bandido também cresce
 *
 * Sem isso a Regência ficaria mais fácil a cada nível, não mais difícil — o
 * time ganha chapéu e o adversário fica parado. O bandido segue a mesma
 * tabela, sempre uma classe atrás: no nível em que o time recebe o primeiro
 * reforço, o bandido ainda não tem nenhum, e só alcança de verdade se a
 * pessoa continuar vencendo.
 */

/** Quantos chapéus a mais cada reforço da Regência dá. */
export const BONUS_DO_PERK = 2;

export interface Perk {
  readonly classe: Classe;
  readonly nome: string;
  readonly descricao: string;
}

const NOME_DO_PERK: Readonly<Record<Classe, string>> = {
  aldeao: '',
  guerreiro: 'Chapelaria de Guerra',
  lanceiro: 'Forja de Lanças',
  arqueiro: 'Depósito de Flechas',
  clerigo: 'Bênção do Convento',
  minerador: 'Picaretas Extras',
  lenhador: 'Machados Extras',
  saqueador: 'Bolsas Extras',
};

export function perkDaClasse(classe: Classe): Perk {
  return {
    classe,
    nome: NOME_DO_PERK[classe],
    descricao: `+${BONUS_DO_PERK} chapéus de ${classe} na chapelaria, a partir de agora.`,
  };
}

/**
 * O reforço do nível N — sempre o mesmo, dado o mesmo nível, para a corrente
 * inteira ser reproduzível a partir da seed da sala. Roda em ordem pelas
 * sete classes com chapéu e recomeça do início quando acaba a lista, então
 * uma campanha longa empilha o mesmo reforço mais de uma vez em vez de parar
 * de crescer.
 */
export function perkDoNivel(nivel: number): Perk {
  const indice = ((nivel - 2) % CLASSES_COM_CHAPEU.length + CLASSES_COM_CHAPEU.length) %
    CLASSES_COM_CHAPEU.length;
  return perkDaClasse(CLASSES_COM_CHAPEU[indice]!);
}
