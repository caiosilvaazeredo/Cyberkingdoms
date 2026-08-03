import type { Government } from '../politics/government';
import type { Settlement } from '../world/settlement';
import type { Inventory } from './inventory';
import { itemDef } from './item';

/**
 * Contrato público: a cidade compra o que a vocação dela **não** produz.
 *
 * ## Por que isto existe
 *
 * O livro de ofertas é dos jogadores: quem vende publica uma oferta e espera
 * outro jogador comprar. Isso é certo num servidor cheio e é uma parede numa
 * campanha de um jogador só — a oferta fica no livro para sempre, o item sai do
 * inventário e nada volta. Sem uma ponta de saída, comprar barato numa cidade
 * produtora e levar até a consumidora não paga nada, e a viagem entre cidades
 * perde o motivo econômico que o mapa promete.
 *
 * O contrato público é essa ponta, e **não** é um NPC mercador: é compra
 * governamental, paga do tesouro que já existe, limitada pelo dinheiro que a
 * cidade tem. Quando o caixa acaba, a cidade para de comprar — que é
 * exatamente o comportamento de um governo, e é o freio que impede o jogador de
 * imprimir crédito num item só.
 *
 * ## O que a cidade compra, e por quanto
 *
 * Só o que a vocação **demanda**, e só produto lícito: contrabando não entra em
 * nota fiscal, e para ele o caminho continua sendo o clandestino. O prêmio de
 * 25% sobre o valor de referência é a diferença que remunera o transporte —
 * quem produz vende no lugar em que o item é abundante, quem carrega ganha a
 * distância.
 *
 * O imposto da cidade incide sobre a venda: o vendedor recebe o líquido e o
 * tesouro devolve para si mesmo a parte tributada. Custo real de caixa é o
 * líquido, e é por ele que o limite de quantidade é calculado — cobrar o bruto
 * faria a cidade recusar compras que ela consegue pagar.
 */

/** Prêmio sobre `baseValue` que a cidade paga pelo que precisa importar. */
export const DEMAND_PREMIUM = 0.25;

export interface ContractQuote {
  readonly item: string;
  /** Bruto por unidade, antes do imposto. */
  readonly unitPrice: number;
  /** Quantas unidades o caixa da cidade ainda consegue pagar. */
  readonly maxQuantity: number;
  readonly taxRate: number;
}

/**
 * Quanto a cidade paga por um item, ou `null` quando ela não compra.
 *
 * `null` e não uma cotação de zero: "esta cidade não compra isto" e "esta
 * cidade está sem caixa" são situações diferentes, e a interface precisa dizer
 * qual das duas o jogador está vendo.
 */
export function quotePublicContract(
  settlement: Settlement,
  government: Government,
  item: string,
): ContractQuote | null {
  const def = itemDef(item);
  if (!def.legal) return null;
  if (!settlement.vocationDef.demands.includes(item)) return null;

  const unitPrice = Math.max(1, Math.round(def.baseValue * (1 + DEMAND_PREMIUM)));
  const liquido = unitPrice - Math.round(unitPrice * government.taxRate);
  const porUnidade = Math.max(1, liquido);

  return {
    item,
    unitPrice,
    maxQuantity: Math.max(0, Math.floor(government.treasury / porUnidade)),
    taxRate: government.taxRate,
  };
}

export type ContractResult =
  | {
      readonly ok: true;
      readonly item: string;
      readonly quantity: number;
      /** O que caiu no bolso do jogador, já sem imposto. */
      readonly credited: number;
      readonly tax: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Executa a venda ao governo.
 *
 * Igual à compra no mercado, a ordem importa: tudo que pode recusar é conferido
 * antes de qualquer alteração. Metade de uma venda — item retirado, crédito não
 * pago — é o defeito que estraga um save sem deixar rastro.
 */
export function sellToGovernment(options: {
  settlement: Settlement;
  government: Government;
  inventory: Inventory;
  item: string;
  quantity: number;
}): ContractResult {
  const { settlement, government, inventory, item, quantity } = options;

  if (quantity <= 0) return { ok: false, reason: 'Quantidade inválida.' };

  const cotacao = quotePublicContract(settlement, government, item);
  if (!cotacao) {
    return {
      ok: false,
      reason: `${settlement.name} não compra ${itemDef(item).name}.`,
    };
  }
  if (!inventory.has(item, quantity)) {
    return { ok: false, reason: 'Você não tem essa quantidade.' };
  }
  if (quantity > cotacao.maxQuantity) {
    return {
      ok: false,
      reason:
        cotacao.maxQuantity === 0
          ? 'O caixa da cidade está vazio.'
          : `O caixa só cobre ${cotacao.maxQuantity} unidade(s).`,
    };
  }

  const bruto = cotacao.unitPrice * quantity;
  const tax = Math.round(bruto * government.taxRate);
  const liquido = bruto - tax;

  if (!inventory.remove(item, quantity)) {
    return { ok: false, reason: 'Você não tem essa quantidade.' };
  }
  // O tesouro paga o bruto e recolhe o imposto de volta: o efeito de caixa é o
  // líquido, e o imposto aparece na conta para o jogador entender por que
  // vender numa cidade de imposto alto rende menos.
  government.treasury -= liquido;

  return { ok: true, item, quantity, credited: liquido, tax };
}
