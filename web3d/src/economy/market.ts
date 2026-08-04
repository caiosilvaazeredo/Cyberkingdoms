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

/** Quanto cada vendedor entregou numa compra. */
export interface Fill {
  readonly orderId: string;
  readonly sellerId: string;
  readonly sellerName: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

export type TradeResult =
  | {
      readonly ok: true;
      readonly item: string;
      readonly quantity: number;
      /** O que sai do bolso do comprador. */
      readonly totalPaid: number;
      /**
       * Taxa de mercado — EB 1.1, §14.
       *
       * Sai do valor da venda e vai para o cofre local; **não** é um acréscimo
       * cobrado do comprador. A diferença importa: como acréscimo, ela empurra
       * o preço do Central para cima e o jogador acha que o clandestino é mais
       * barato quando ele só é mais sonegado. Como desconto na venda, quem paga
       * a taxa é quem lucrou com ela, que é o que o documento descreve.
       */
      readonly tax: number;
      /** Quem entregou o quê. Vazio quando o chamador não precisa saber. */
      readonly fills: readonly Fill[];
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
  /**
   * Ponto de partida da rodada, por item e faixa de preço.
   *
   * Não vai para o save: é uma preferência de distribuição, não patrimônio.
   * Perder o cursor num recarregamento faz a próxima compra começar do primeiro
   * vendedor da faixa — inofensivo. Persistir custaria uma chave por item por
   * preço em todo mundo salvo.
   */
  private readonly cursores = new Map<string, number>();

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
   * Compra direta: o comprador escolheu o anúncio — EB 1.1, §12 e §13.
   *
   * Varre da oferta mais barata para a mais cara e **não** passa pela rodada de
   * equalização. É o que o documento chama de `direct`: quem escolheu o
   * vendedor tem direito ao vendedor, e distribuir a compra dele entre outros
   * seria desfazer a escolha.
   */
  buy(options: {
    item: string;
    quantity: number;
    availableCredits: number;
    taxRate: number;
  }): TradeResult {
    return this.liquidar(options, (livro, quantidade) => {
      // Compra direta: varre da mais barata para a mais cara, sem rodada. É a
      // escolha do comprador, e o EB diz explicitamente que a direta não passa
      // pela equalização — quem escolheu o vendedor tem direito ao vendedor.
      const fills: Fill[] = [];
      let restante = quantidade;
      for (const order of livro) {
        if (restante === 0) break;
        const leva = Math.min(restante, order.quantity);
        fills.push({
          orderId: order.id,
          sellerId: order.sellerId,
          sellerName: order.sellerName,
          quantity: leva,
          unitPrice: order.unitPrice,
        });
        restante -= leva;
      }
      return fills;
    });
  }

  /**
   * Compra rápida com equalização por rodadas — EB 1.1, §13.
   *
   * ## O problema que a rodada resolve
   *
   * Varrendo só do mais barato para o mais caro, o primeiro da fila leva tudo.
   * Com dez vendedores pedindo o mesmo preço, um vende dez e nove não vendem
   * nada — e como quem publicou primeiro fica sempre na frente, o mercado
   * premia relógio em vez de preço. A liquidez que o EB persegue (≥60% dos
   * anúncios com venda) morre aí.
   *
   * Então: preço menor continua tendo prioridade absoluta — isso é mercado, não
   * sorteio —, mas **dentro da mesma faixa de preço** a compra distribui uma
   * unidade por vez entre os vendedores, e o ponto de partida da rodada avança
   * a cada compra. É o A→B→C do documento.
   *
   * O cursor é guardado por item e faixa: sem persistir, toda compra começaria
   * no mesmo vendedor e a rodada viraria enfeite.
   */
  quickBuy(options: {
    item: string;
    quantity: number;
    availableCredits: number;
    taxRate: number;
  }): TradeResult {
    return this.liquidar(options, (livro, quantidade) => {
      const porPreco = new Map<number, MarketOrder[]>();
      for (const o of livro) {
        const grupo = porPreco.get(o.unitPrice);
        if (grupo) grupo.push(o);
        else porPreco.set(o.unitPrice, [o]);
      }

      const acumulado = new Map<string, Fill>();
      let restante = quantidade;

      for (const preco of [...porPreco.keys()].sort((a, b) => a - b)) {
        if (restante === 0) break;
        const grupo = porPreco.get(preco)!;
        const chave = `${options.item}@${preco}`;
        let cursor = this.cursores.get(chave) ?? 0;
        const disponivel = new Map(grupo.map((o) => [o.id, o.quantity]));

        // Uma unidade por rodada, do cursor em diante. O `voltas` protege
        // contra o caso em que o grupo inteiro esgotou antes da quantidade.
        let voltas = 0;
        while (restante > 0 && voltas < grupo.length) {
          const order = grupo[cursor % grupo.length]!;
          cursor += 1;
          const sobra = disponivel.get(order.id) ?? 0;
          if (sobra <= 0) {
            voltas += 1;
            continue;
          }
          voltas = 0;
          disponivel.set(order.id, sobra - 1);
          restante -= 1;

          const anterior = acumulado.get(order.id);
          acumulado.set(order.id, {
            orderId: order.id,
            sellerId: order.sellerId,
            sellerName: order.sellerName,
            quantity: (anterior?.quantity ?? 0) + 1,
            unitPrice: order.unitPrice,
          });
        }
        this.cursores.set(chave, cursor % Math.max(1, grupo.length));
      }

      return [...acumulado.values()];
    });
  }

  /**
   * O tronco comum das duas compras.
   *
   * A varredura acontece **duas vezes**: uma para simular, outra para efetivar.
   * Numa passada só, o dinheiro acabando no meio deixaria metade das ofertas já
   * debitadas e a compra recusada — o comprador não leva nada e o vendedor
   * perde o estoque. Simular antes é o que torna a operação atômica sem
   * precisar de transação.
   */
  private liquidar(
    options: {
      item: string;
      quantity: number;
      availableCredits: number;
      taxRate: number;
    },
    distribuir: (livro: MarketOrder[], quantidade: number) => Fill[],
  ): TradeResult {
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

    const fills = distribuir(livro, quantity);
    const subtotal = fills.reduce((soma, f) => soma + f.quantity * f.unitPrice, 0);
    if (subtotal > availableCredits) {
      return { ok: false, reason: `Créditos insuficientes: precisa de ${subtotal}.` };
    }

    // Só o Central recolhe: o clandestino não passa por governo nenhum, e é
    // justamente a diferença de imposto que dá razão para ele existir. Arredonda
    // para baixo porque o EB fixa o mínimo em zero — item barato não paga taxa
    // artificial de um Cz.
    const tax = this.kind === 'central' ? Math.floor(subtotal * taxRate) : 0;

    const porId = new Map(livro.map((o) => [o.id, o]));
    for (const f of fills) {
      const order = porId.get(f.orderId);
      if (order) order.quantity -= f.quantity;
    }
    this.removeEmpty();

    return { ok: true, item, quantity, totalPaid: subtotal, tax, fills };
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
