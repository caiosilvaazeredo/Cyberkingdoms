import { itemDef } from '../economy/item';
import { resolveUpkeep } from '../survival/dailyActivity';
import { findRoute, nearestSettlement, type TravelRoute } from '../world/travel';
import type { Campaign } from './campaign';

/**
 * Começar uma viagem.
 *
 * ## O que já existia, e o que faltava
 *
 * O reset diário sempre soube encerrar uma viagem: ele desconta um dia de
 * `travelDaysRemaining`, cobra o trânsito como atividade, rola o encontro na
 * estrada e, no último dia, muda o personagem de lugar. O que não existia era
 * o começo — nenhuma tela colocava o jogador em trânsito, e por isso as vinte
 * cidades do mapa eram vinte lugares que ele nunca ia ver.
 *
 * Este módulo é só a partida: escolhe a rota, cobra o que tem de ser cobrado e
 * entrega o personagem ao reset, que já sabe o resto.
 *
 * ## Por que a chegada é o destino final, e não escala por escala
 *
 * Uma rota de três pernas vira uma viagem só, com a soma dos dias. Modelar as
 * paradas exigiria guardar a rota inteira no save e decidir o que acontece em
 * cada escala — e o jogador que atravessa não desce em cidade nenhuma. Se um
 * dia isso virar conteúdo (parar para vender no meio do caminho), o lugar de
 * mudar é aqui, e o save de hoje continua válido.
 */

export type JourneyResult =
  | { readonly ok: true; readonly route: TravelRoute; readonly fromId: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Confere se dá para viajar e devolve a rota, sem alterar nada.
 *
 * Separado de `startJourney` porque a tela precisa mostrar dias e perigo
 * **antes** do jogador decidir: um botão que só revela o custo depois do toque
 * é o mesmo que um botão sem preço.
 */
export function planJourney(campaign: Campaign, destinationId: string): JourneyResult {
  const character = campaign.character;
  if (character.dead) return { ok: false, reason: 'O personagem está morto.' };
  if (character.isTravelling) {
    return { ok: false, reason: 'Você já está em trânsito.' };
  }

  const destino = campaign.world.layout.byId(destinationId);
  if (!destino) return { ok: false, reason: 'Cidade desconhecida.' };

  // A saída é a cidade onde o jogador está; fora de cidade, a mais próxima.
  const origem =
    campaign.currentSettlementId ??
    nearestSettlement(campaign.world.layout, character.position)?.id ??
    null;
  if (!origem) return { ok: false, reason: 'Não há cidade de saída no mapa.' };
  if (origem === destinationId) {
    return { ok: false, reason: `Você já está em ${destino.name}.` };
  }

  const route = findRoute(campaign.world.layout, origem, destinationId);
  if (!route) {
    return { ok: false, reason: `Não há estrada até ${destino.name}.` };
  }
  return { ok: true, route, fromId: origem };
}

/**
 * Põe o personagem na estrada.
 *
 * O dia **não** avança aqui. Quem conta dia é o reset, e adiantá-lo neste
 * ponto cobraria o primeiro dia de viagem duas vezes — uma agora, outra na
 * virada. Sair é uma decisão; o custo chega com a meia-noite.
 */
export function startJourney(campaign: Campaign, destinationId: string): JourneyResult {
  const plano = planJourney(campaign, destinationId);
  if (!plano.ok) return plano;

  const character = campaign.character;
  character.travellingTo = destinationId;
  character.travelDaysRemaining = Math.max(1, plano.route.days);

  const destino = campaign.world.layout.byId(destinationId)!;
  const saida = campaign.world.layout.byId(plano.fromId)!;
  campaign.log(
    `Partiu de ${saida.name} para ${destino.name} — ` +
      `${character.travelDaysRemaining} dia(s) de estrada.`,
  );
  return plano;
}

/**
 * Quantos dias de estrada o jogador aguenta com o que carrega.
 *
 * Uma viagem de dez dias custa dez vezes o consumo de um dia de trânsito, e não
 * existe mercado no meio do caminho: quem sai sem comida chega morto. O número
 * sai dos vitais de agora **mais** o que a mochila repõe, dividido pelo custo
 * diário da estrada — a mesma conta que o reset faz, para o aviso não prometer
 * o que o reset não cumpre.
 */
export function daysOfSupplies(campaign: Campaign): number {
  const character = campaign.character;
  let fome = character.hunger;
  let sede = character.thirst;
  for (const [id, quantidade] of character.inventory.stacks) {
    if (quantidade <= 0) continue;
    const def = itemDef(id);
    // Líquido: um estimulante que devolve fome e cobra sede não conta como
    // duas refeições.
    fome += Math.max(0, def.restoresHunger - def.hungerCost) * quantidade;
    sede += Math.max(0, def.restoresThirst - def.thirstCost) * quantidade;
  }

  const gear = character.inventory.upkeepModifiers;
  const diario = resolveUpkeep(
    { roadsTravelled: 1, sleptOnRoad: true },
    { hungerModifier: gear.hunger, thirstModifier: gear.thirst },
  ).total;

  return Math.floor(
    Math.min(
      diario.hunger > 0 ? fome / diario.hunger : Number.POSITIVE_INFINITY,
      diario.thirst > 0 ? sede / diario.thirst : Number.POSITIVE_INFINITY,
    ),
  );
}

/** Desiste da viagem. O dia já gasto na estrada não volta. */
export function cancelJourney(campaign: Campaign): void {
  campaign.character.travellingTo = null;
  campaign.character.travelDaysRemaining = 0;
}
