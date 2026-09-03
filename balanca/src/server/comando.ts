import { CLASSES_COM_CHAPEU, type Classe } from '../shared/classes';
import type { Time } from '../shared/regras';

/**
 * Quem manda no time, e como o time manda nos npcs.
 *
 * ## O problema
 *
 * Uma sala com dois humanos e quatro npcs tem quatro personagens jogando de
 * aldeão porque o bot escolheu sozinho. As pessoas veem isso e querem mexer —
 * "põe um arqueiro na ponte" —, e hoje não há por onde. Este arquivo é o por
 * onde.
 *
 * ## Duas formas, e a diferença entre elas é política
 *
 * **Ordem** é o líder decidindo. É rápida e serve para o meio da briga, quando
 * ninguém tem tempo de votar em nada.
 *
 * **Votação** é o líder abrindo a decisão para o time. Só quem é **gente** vota
 * — um npc votando na própria classe seria o time decidindo por maioria de
 * máquina, que é o oposto do que a votação existe para fazer.
 *
 * As duas terminam no mesmo lugar: uma classe pedida para um npc. O que muda é
 * quem decidiu.
 *
 * ## Por que a votação tem prazo, e por que a maioria é dos que votaram
 *
 * Sem prazo, uma votação que ninguém responde trava o pedido para sempre e o
 * npc continua de aldeão — o defeito exato que a função existe para resolver.
 * Com prazo, o silêncio vira uma resposta: vence quem teve mais votos entre os
 * que votaram, e o empate fica com a opção que o líder propôs, porque foi ele
 * quem levantou o assunto.
 *
 * ## Por que isto não está no `partida.ts`
 *
 * A simulação não sabe o que é um líder nem o que é um cliente conectado — ela
 * sabe de unidades. Liderança e votação são coisas da **sala**: dependem de
 * quem está conectado, sobrevivem ao fim de uma partida e não fazem parte do
 * estado que o cliente prevê. Enfiá-las no tick misturaria as duas coisas e
 * faria a previsão local carregar uma urna.
 */

/** Segundos que uma votação fica aberta. */
export const PRAZO_DA_VOTACAO = 20;

export interface Voto {
  /** Chave do cliente que votou. Um voto por pessoa; o último vale. */
  readonly de: string;
  readonly classe: Classe;
}

export interface Votacao {
  /** A unidade npc cuja classe está em jogo. */
  readonly alvo: number;
  /** Quem abriu. Desempata. */
  readonly proposta: Classe;
  readonly time: Time;
  /** Segundos restantes. */
  restante: number;
  readonly votos: Map<string, Classe>;
}

/** O resultado de uma votação encerrada. */
export interface Apuracao {
  readonly alvo: number;
  readonly classe: Classe;
  readonly votos: number;
  readonly total: number;
}

/**
 * Uma classe que faz sentido pedir a um npc.
 *
 * Só as que têm chapéu: mandar alguém "ser aldeão" é mandar tirar o chapéu, o
 * que é uma ordem legítima mas não é o que a tela oferece — e aceitar qualquer
 * texto aqui deixaria a rede escolher a classe de uma unidade.
 */
export function classePedivel(bruta: unknown): Classe | null {
  return CLASSES_COM_CHAPEU.includes(bruta as Classe) ? (bruta as Classe) : null;
}

/**
 * Apura os votos.
 *
 * A ordem de desempate é fixa e não sorteada: mais votos, depois a proposta do
 * líder, depois a ordem de `CLASSES_COM_CHAPEU`. Um sorteio faria a mesma
 * votação dar resultados diferentes, e a primeira reclamação seria de que o
 * jogo roubou.
 */
export function apurar(v: Votacao): Apuracao {
  const contagem = new Map<Classe, number>();
  for (const classe of v.votos.values()) {
    contagem.set(classe, (contagem.get(classe) ?? 0) + 1);
  }

  let vencedora = v.proposta;
  let melhor = contagem.get(v.proposta) ?? 0;
  for (const classe of CLASSES_COM_CHAPEU) {
    const quantos = contagem.get(classe) ?? 0;
    if (quantos > melhor) {
      melhor = quantos;
      vencedora = classe;
    }
  }
  return { alvo: v.alvo, classe: vencedora, votos: melhor, total: v.votos.size };
}
