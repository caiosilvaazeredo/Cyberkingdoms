import type { DeterministicRandom } from '../core/rng';
import { allItems, itemDef } from './item';

/**
 * Os dois mercados do GDD.
 *
 * ## Quem forma o preço é o jogador
 *
 * Não existe NPC abastecendo o livro. Tudo que está à venda saiu do inventário
 * de alguém que produziu, e é isso que faz a economia ser dos jogadores e não
 * uma tabela. A única exceção é o estoque inicial dos colonos — ver `seedMarket`,
 * que explica por que ela não contradiz a regra.
 *
 * ## Por que cada cidade tem o próprio livro
 *
 * É o que faz a geografia importar. O mesmo chip custa preços diferentes em
 * capitais diferentes, e a diferença é o que paga a viagem — sem ela, viajar
 * seria só tempo perdido e o mapa viraria cenário.
 */

export type MarketKind = 'central' | 'clandestine';

export const marketKindLabels: Record<MarketKind, string> = {
  central: 'Mercado Central',
  clandestine: 'Mercado Clandestino',
};

/** O Central só aceita produto lícito; o clandestino aceita tudo. */
export function marketAccepts(kind: MarketKind, item: string): boolean {
  return kind === 'clandestine' || itemDef(item).legal;
}

export interface MarketOrderJson {
  id: string;
  sellerId: string;
  sellerName: string;
  item: string;
  quantity: number;
  unitPrice: number;
  postedOnDay: number;
}

export class MarketOrder {
  constructor(
    readonly id: string,
    readonly sellerId: string,
    readonly sellerName: string,
    readonly item: string,
    public quantity: number,
    readonly unitPrice: number,
    readonly postedOnDay: number,
  ) {}

  get totalPrice(): number {
    return this.quantity * this.unitPrice;
  }

  toJson(): MarketOrderJson {
    return {
      id: this.id,
      sellerId: this.sellerId,
      sellerName: this.sellerName,
      item: this.item,
      quantity: this.quantity,
      unitPrice: this.unitPrice,
      postedOnDay: this.postedOnDay,
    };
  }

  static fromJson(json: MarketOrderJson): MarketOrder {
    return new MarketOrder(
      json.id,
      json.sellerId,
      json.sellerName,
      json.item,
      Number(json.quantity) || 0,
      Number(json.unitPrice) || 0,
      Number(json.postedOnDay) || 0,
    );
  }
}

export type TradeResult =
  | {
      readonly ok: true;
      readonly item: string;
      readonly quantity: number;
      readonly totalPaid: number;
      readonly tax: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * O que o mercado precisa saber sobre a cidade para semear o estoque inicial.
 *
 * Estrutural em vez de importar `Settlement`: o assentamento ainda não foi
 * portado, e nada aqui precisa dele inteiro. Quando ele chegar, satisfaz esta
 * forma sem alterar uma linha deste arquivo.
 */
export interface MarketSettlement {
  readonly isCapital: boolean;
  readonly vocation: {
    readonly produces: readonly string[];
    readonly demands: readonly string[];
  };
}

export interface MarketJson {
  settlementId: string;
  kind: MarketKind;
  orders: MarketOrderJson[];
}

export class Market {
  private readonly list: MarketOrder[];

  constructor(
    readonly settlementId: string,
    readonly kind: MarketKind,
    orders: readonly MarketOrder[] = [],
  ) {
    this.list = [...orders];
  }

  get orders(): readonly MarketOrder[] {
    return this.list;
  }

  /** Ofertas vivas de um item, da mais barata para a mais cara. */
  ordersFor(item: string): MarketOrder[] {
    return this.list
      .filter((o) => o.item === item && o.quantity > 0)
      .sort((a, b) => a.unitPrice - b.unitPrice);
  }

  /** Menor preço pedido — a cotação que o jogador vê na lista. */
  bestPrice(item: string): number | null {
    return this.ordersFor(item)[0]?.unitPrice ?? null;
  }

  supplyOf(item: string): number {
    return this.ordersFor(item).reduce((soma, o) => soma + o.quantity, 0);
  }

  get listedItems(): string[] {
    const vistos = new Set<string>();
    for (const o of this.list) if (o.quantity > 0) vistos.add(o.item);
    return [...vistos];
  }

  /** Publica uma oferta. `null` quando o mercado não aceita o item. */
  postOrder(options: {
    sellerId: string;
    sellerName: string;
    item: string;
    quantity: number;
    unitPrice: number;
    day: number;
  }): MarketOrder | null {
    if (!marketAccepts(this.kind, options.item)) return null;
    if (options.quantity <= 0 || options.unitPrice <= 0) return null;

    const order = new MarketOrder(
      `ord_${this.settlementId}_${this.kind}_${options.day}_${this.list.length}`,
      options.sellerId,
      options.sellerName,
      options.item,
      options.quantity,
      options.unitPrice,
      options.day,
    );
    this.list.push(order);
    return order;
  }

  /**
   * Compra varrendo as ofertas mais baratas primeiro.
   *
   * A varredura acontece **duas vezes**: uma para simular, outra para efetivar.
   * Numa passada só, o dinheiro acabando no meio deixaria metade das ofertas
   * já debitadas e a compra recusada — o comprador não leva nada e o vendedor
   * perde o estoque. Simular antes é o que torna a operação atômica sem
   * precisar de transação.
   */
  buy(options: {
    item: string;
    quantity: number;
    availableCredits: number;
    taxRate: number;
  }): TradeResult {
    const { item, quantity, availableCredits, taxRate } = options;

    if (quantity <= 0) return { ok: false, reason: 'Quantidade inválida.' };
    if (!marketAccepts(this.kind, item)) {
      return { ok: false, reason: 'Este mercado não negocia esse item.' };
    }

    const livro = this.ordersFor(item);
    const oferta = livro.reduce((soma, o) => soma + o.quantity, 0);
    if (oferta < quantity) {
      return { ok: false, reason: `Oferta insuficiente: só há ${oferta} em estoque.` };
    }

    let restante = quantity;
    let subtotal = 0;
    for (const order of livro) {
      if (restante === 0) break;
      const leva = Math.min(restante, order.quantity);
      subtotal += leva * order.unitPrice;
      restante -= leva;
    }

    // Só o Central recolhe: o clandestino não passa por governo nenhum, e é
    // justamente a diferença de imposto que dá razão para ele existir.
    const tax = this.kind === 'central' ? Math.round(subtotal * taxRate) : 0;
    const total = subtotal + tax;
    if (total > availableCredits) {
      return { ok: false, reason: `Créditos insuficientes: precisa de ${total}.` };
    }

    restante = quantity;
    for (const order of livro) {
      if (restante === 0) break;
      const leva = Math.min(restante, order.quantity);
      order.quantity -= leva;
      restante -= leva;
    }
    this.removeEmpty();

    return { ok: true, item, quantity, totalPaid: total, tax };
  }

  /** Descarta ofertas antigas para o livro não crescer sem limite. */
  expireOrders(currentDay: number, maxAgeInDays = 14): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (currentDay - this.list[i]!.postedOnDay > maxAgeInDays) {
        this.list.splice(i, 1);
      }
    }
  }

  private removeEmpty(): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i]!.quantity <= 0) this.list.splice(i, 1);
    }
  }

  toJson(): MarketJson {
    return {
      settlementId: this.settlementId,
      kind: this.kind,
      orders: this.list.map((o) => o.toJson()),
    };
  }

  static fromJson(json: MarketJson): Market {
    return new Market(
      json.settlementId,
      json.kind,
      (json.orders ?? []).map(MarketOrder.fromJson),
    );
  }
}

/**
 * Semeia o livro no início da campanha.
 *
 * Isto **não** contradiz "não existem NPCs abastecendo o mercado": é o estoque
 * dos colonos que já estavam ali quando a campanha começou. A partir do dia 1
 * nada mais entra sem um jogador ter produzido.
 *
 * Cidade produtora tem estoque farto e barato; consumidora, escasso e caro. É
 * essa assimetria que cria a rota comercial — sem ela, todo mercado teria o
 * mesmo preço e viajar não pagaria.
 */
export function seedMarket(
  market: Market,
  settlement: MarketSettlement,
  rng: DeterministicRandom,
): void {
  const catalogo =
    market.kind === 'clandestine'
      ? allItems.filter((d) => !d.legal || d.category === 'drug')
      : allItems.filter((d) => d.legal);

  for (const def of catalogo) {
    const produz = settlement.vocation.produces.includes(def.id);
    const demanda = settlement.vocation.demands.includes(def.id);

    if (!produz && !demanda && rng.chance(0.55)) continue;

    const escala = settlement.isCapital ? 1.0 : 0.45;
    const quantidade = Math.round(
      (produz ? rng.range(40, 140) : demanda ? rng.range(2, 12) : rng.range(6, 40)) *
        escala,
    );
    if (quantidade <= 0) continue;

    const fatorPreco = produz
      ? rng.rangeDouble(0.62, 0.88)
      : demanda
        ? rng.rangeDouble(1.25, 1.85)
        : rng.rangeDouble(0.9, 1.2);
    const premioClandestino =
      market.kind === 'clandestine' ? rng.rangeDouble(1.15, 1.6) : 1.0;

    const unitPrice = Math.min(
      999999,
      Math.max(1, Math.round(def.baseValue * fatorPreco * premioClandestino)),
    );

    market.postOrder({
      sellerId: 'colonos',
      sellerName: 'Estoque dos Colonos',
      item: def.id,
      quantity: quantidade,
      unitPrice,
      day: 0,
    });
  }
}
