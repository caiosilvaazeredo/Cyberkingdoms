import type { Campaign } from './campaign';
import { itemDef } from '../economy/item';

/**
 * Acampar: comer e beber do que se carrega, antes de o dia virar.
 *
 * ## Por que isto existe
 *
 * Na cidade, comer é decisão — dá para segurar a fome e gastar o dinheiro em
 * outra coisa, e essa tensão é jogo. Na estrada não é: não existe mercado no
 * meio do caminho, o único recurso é a mochila, e a única resposta certa é
 * usá-la. Deixar isso na mão do jogador não cria escolha, cria armadilha — uma
 * viagem de sete dias vira sete toques em "dormir" e catorze idas à mochila, e
 * quem esquecer uma chega morto.
 *
 * A decisão de verdade acontece **antes** de partir, quando a tela mostra
 * quantos dias de mantimento a mochila cobre. Depois disso, só resta executar.
 *
 * ## O que isto não é
 *
 * Não é regra nova. Chama o mesmo `consume` que o botão da mochila chama, com
 * o mesmo lote da despensa, e só faz o que o jogador faria à mão. Fora da
 * estrada não faz nada.
 */

/** Abaixo disto o viajante come. Acima, guarda o que tem. */
const LIMIAR = 60;

/**
 * Quantas vezes tenta repor por dia.
 *
 * Um dia de estrada custa mais que um item repõe, e parar na primeira rodada
 * deixaria o viajante sempre no vermelho. O teto existe para que uma mochila
 * cheia não seja esvaziada num dia só.
 */
const RODADAS = 4;

export function acampar(campaign: Campaign, agora = Date.now()): string[] {
  const character = campaign.character;
  if (!character.isTravelling || character.dead) return [];

  const consumidos: string[] = [];
  for (let rodada = 0; rodada < RODADAS; rodada++) {
    if (character.hunger >= LIMIAR && character.thirst >= LIMIAR) break;

    // O que estiver mais baixo manda. Comer com a sede no chão gasta um item
    // que talvez fosse o último, e não resolve o que estava matando.
    const querBebida = character.thirst <= character.hunger;
    const candidatos = [...character.inventory.stacks.entries()]
      .filter(([id, quantidade]) => {
        if (quantidade <= 0) return false;
        const def = itemDef(id);
        // O saldo líquido é o que importa: um estimulante que devolve fome e
        // cobra sede não é comida numa viagem.
        return querBebida
          ? def.restoresThirst > def.thirstCost
          : def.restoresHunger > def.hungerCost;
      })
      // O mais barato primeiro. Guardar a refeição boa para quando ela for
      // necessária é o que qualquer viajante faz, e é o que preserva o item
      // caro para vender na chegada.
      .sort(([a], [b]) => itemDef(a).baseValue - itemDef(b).baseValue);

    const escolhido = candidatos[0]?.[0];
    if (!escolhido || !character.consume(escolhido)) break;
    campaign.pantry.consume(escolhido, 1, agora);
    consumidos.push(itemDef(escolhido).name);
  }
  return consumidos;
}
